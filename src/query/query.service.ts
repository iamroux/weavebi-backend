import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateQueryDto } from './dto/create-query.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryEntity } from './entities/query.entity';
import { DataSource, Repository } from 'typeorm';
import OpenAI from 'openai';
import * as QueryPrompts from './query-prompts';
import { DashboardEntity } from '../dashboard/entities/dashboard.entity';
import { EncryptionService } from './encryption.service';
import { ExecuteQueryDto } from './dto/execute-query.dto';
import { DashboardService } from 'src/dashboard/dashboard.service';
import { getSSLConfig, mapProviderToTypeORM } from 'src/common/database-utils';
import { SSLMode } from 'src/userdb/entities/userdb.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class QueryService {
  private readonly logger = new Logger(QueryService.name);

  private readonly OPENAI_API_KEY: string;
  private readonly OPENAI_MODEL: string;
  private readonly OPENAI_TEMPERATURE: number;

  constructor(
    @InjectRepository(QueryEntity)
    private readonly queryRepo: Repository<QueryEntity>,
    private readonly encryptionService: EncryptionService,
    private readonly dashboardService: DashboardService,
    private readonly configService: ConfigService,
  ) {
    this.OPENAI_API_KEY = this.configService.get<string>(
      'llm.apiKey',
    ) as string;
    this.OPENAI_MODEL = this.configService.get<string>('llm.model') as string;
    this.OPENAI_TEMPERATURE = Number(
      this.configService.get<number>('llm.temperature'),
    );
  }

  // Helper method to generate SQL query using OpenAI
  private async generateSqlQuery(
    promptType: string,
    userQuery: string,
    schema: string,
    provider: string,
    outputType?: string,
  ): Promise<string> {
    const openai = new OpenAI({ apiKey: this.OPENAI_API_KEY });

    let prompt = `
      Schema: ${schema}
      User Query: ${userQuery}
      Provider: ${provider}`;

    if (outputType) {
      prompt += `\nOutput Type: ${outputType}`;
    }

    try {
      const response = await openai.chat.completions.create({
        model: this.OPENAI_MODEL,
        temperature: this.OPENAI_TEMPERATURE,
        messages: [
          { role: 'system', content: QueryPrompts.primaryPrompt },
          { role: 'user', content: prompt },
        ],
      });

      const cleanResponse = response.choices[0].message.content?.trim() ?? '';
      this.logger.debug(`Generated SQL query: ${cleanResponse}`);

      if (cleanResponse.includes('bad request')) {
        this.logger.warn(
          'Asked user query didnt make any sense to LLM. Query execution blocked',
        );
        return `SELECT 'Invalid query' as message;`;
      }

      // Security check for DML operations (nakli guardrails but works)
      const dmlKeywords = [
        'INSERT',
        'UPDATE',
        'DELETE',
        'CREATE',
        'ALTER',
        'DROP',
        'MERGE',
        'CALL',
        'LOCK',
        'TRUNCATE',
      ];

      const dmlRegex = new RegExp(`\\b(${dmlKeywords.join('|')})\\b`, 'i');
      if (dmlRegex.test(cleanResponse)) {
        this.logger.warn(
          'Generated SQL query contains DML keywords. Query execution blocked',
        );
        return `SELECT 'Query execution blocked. Please contact support for assistance.' as message;`;
      }

      return cleanResponse;
    } catch (error) {
      if (
        error.constructor.name === 'APIConnectionError' ||
        error.message.includes('Connection error') ||
        error.cause?.code === 'EAI_AGAIN' ||
        error.cause?.errno === 'EAI_AGAIN'
      ) {
        throw new HttpException(
          'Network issue connecting to AI service.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      this.logger.error('Error generating SQL query:', error);
      throw new BadRequestException('Failed to generate SQL query.');
    }
  }

  // Helper method to execute SQL query against database
  private async executeSqlQuery(
    sqlQuery: string,
    host: string,
    username: string,
    password: string,
    database: string,
    port: number,
    provider: string,
    sslMode: SSLMode = SSLMode.DISABLE,
  ): Promise<any> {
    let dataSource: DataSource | null = null;

    try {
      // Map provider to TypeORM's expected type
      const typeormProvider = mapProviderToTypeORM(
        provider as 'mysql' | 'mariadb' | 'postgres' | 'mssql' | 'oracle',
      );

      dataSource = new DataSource({
        type: typeormProvider,
        host,
        port,
        username,
        password,
        database,
        ssl: getSSLConfig(sslMode),
      });

      await dataSource.initialize();
      this.logger.log('SQL query executed');
      return await dataSource.query(sqlQuery);
    } catch (error) {
      this.logger.error(`Failed to execute query: ${error.message}`);
      throw new BadRequestException(
        `Failed to execute query: ${error.message}`,
      );
    } finally {
      if (dataSource?.isInitialized) {
        await dataSource.destroy();
      }
    }
  }

  // Process query results based on output type
  private async processQueryResults(
    query: string,
    generatedSqlQuery: string,
    dataFromDatabase: any,
    outputType: string,
  ): Promise<string> {
    const openai = new OpenAI({ apiKey: this.OPENAI_API_KEY });
    let prompt = `
        Original User Query: ${query}
        Generated SQL Query: ${generatedSqlQuery}
        Data From Database: ${JSON.stringify(dataFromDatabase)}`;

    if (outputType !== 'descriptive') {
      prompt += `\nGraphical Representation Type: ${outputType}`;
    }

    const systemContent =
      outputType === 'descriptive'
        ? QueryPrompts.descriptivePrompt
        : QueryPrompts.chartJsFormatterPrompt;

    const response = await openai.chat.completions.create({
      model: this.OPENAI_MODEL,
      temperature: this.OPENAI_TEMPERATURE,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: prompt },
      ],
    });

    return response.choices[0].message.content?.trim() ?? '';
  }

  // Main method to run a query
  async runQuery(queryId: number, userId: number) {
    try {
      const queryEntity = await this.queryRepo.findOne({
        where: {
          id: queryId,
          userId: userId,
        },
        relations: ['database'],
      });

      if (!queryEntity) {
        throw new NotFoundException('Query not found or unauthorized');
      }

      // Extract query and database details
      const { query, outputType } = queryEntity;
      const password = await this.encryptionService.decrypt(
        queryEntity.database.password,
      );
      const { host, username, name, port, schema, provider } =
        queryEntity.database;

      let finalData: any;
      let generatedSqlQuery: string;

      // Generate SQL based on output type
      if (outputType === 'tabular') {
        generatedSqlQuery = await this.generateSqlQuery(
          QueryPrompts.primaryPrompt,
          query,
          schema,
          provider,
        );

        finalData = await this.executeSqlQuery(
          generatedSqlQuery,
          host,
          username,
          password,
          name,
          port,
          provider,
        );
      } else {
        // For descriptive and graphical outputs
        const promptType =
          outputType === 'descriptive'
            ? QueryPrompts.primaryPrompt
            : QueryPrompts.graphicalPrompt;

        generatedSqlQuery = await this.generateSqlQuery(
          promptType,
          query,
          schema,
          provider,
          outputType,
        );

        const dataFromDatabase = await this.executeSqlQuery(
          generatedSqlQuery,
          host,
          username,
          password,
          name,
          port,
          provider,
        );

        finalData = await this.processQueryResults(
          query,
          generatedSqlQuery,
          dataFromDatabase,
          outputType,
        );
      }

      // Update and save query entity
      queryEntity.data =
        outputType === 'tabular' ? JSON.stringify(finalData) : finalData; // need to convert tabular data into json object.
      queryEntity.generatedSqlQuery = generatedSqlQuery;
      await this.queryRepo.save(queryEntity);

      this.logger.log(`Output for Query ${queryId} saved`);

      // Return cleaned response
      return {
        id: queryEntity.id,
        name: queryEntity.name,
        query: queryEntity.query,
        outputType: queryEntity.outputType,
        generatedSqlQuery: queryEntity.generatedSqlQuery,
        data:
          queryEntity.outputType === 'descriptive'
            ? queryEntity.data
            : JSON.parse(queryEntity.data), // parse if outputType is not descriptive
        createdAt: queryEntity.createdAt,
        updatedAt: queryEntity.updatedAt,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Failed to run query: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to run query: ${error.message}`,
      );
    }
  }
  async directRunQuery(
    userId: number,
    createQueryDto: CreateQueryDto,
    save: boolean = false,
  ) {
    try {
      if (save) {
        const existingQuery = await this.queryRepo.findOne({
          where: {
            name: createQueryDto.name,
            query: createQueryDto.query,
            outputType: createQueryDto.outputType,
            databaseId: createQueryDto.databaseId,
            userId: userId,
          },
        });

        if (existingQuery) {
          throw new BadRequestException(
            'Query with the same parameters already exists',
          );
        }
      }
      const database = await this.queryRepo.query(
        `SELECT * FROM databases WHERE "id"=$1 AND "userId"=$2`,
        [createQueryDto.databaseId, userId],
      );

      if (!database.length) {
        throw new NotFoundException('Database not found');
      }

      const { query, outputType } = createQueryDto;
      const password = await this.encryptionService.decrypt(
        database[0].password,
      );
      const { host, username, name, port, schema, provider } = database[0];

      let finalData: any;
      let generatedSqlQuery: string;

      if (outputType === 'tabular') {
        generatedSqlQuery = await this.generateSqlQuery(
          QueryPrompts.primaryPrompt,
          query,
          schema,
          provider,
        );

        finalData = await this.executeSqlQuery(
          generatedSqlQuery,
          host,
          username,
          password,
          name,
          port,
          provider,
        );
      } else {
        const promptType =
          outputType === 'descriptive'
            ? QueryPrompts.primaryPrompt
            : QueryPrompts.graphicalPrompt;

        generatedSqlQuery = await this.generateSqlQuery(
          promptType,
          query,
          schema,
          provider,
          outputType,
        );

        const dataFromDatabase = await this.executeSqlQuery(
          generatedSqlQuery,
          host,
          username,
          password,
          name,
          port,
          provider,
        );

        finalData = await this.processQueryResults(
          query,
          generatedSqlQuery,
          dataFromDatabase,
          outputType,
        );
      }

      const queryEntity = this.queryRepo.create({
        name: createQueryDto.name,
        query: createQueryDto.query,
        outputType: createQueryDto.outputType,
        databaseId: createQueryDto.databaseId,
        userId: userId,
        data: finalData,
        generatedSqlQuery: generatedSqlQuery,
      });

      if (save) {
        await this.queryRepo.save(queryEntity);
        this.logger.log(`Query ${queryEntity.id} saved`);
      }

      const result = {
        id: queryEntity.id,
        name: queryEntity.name,
        query: queryEntity.query,
        outputType: queryEntity.outputType,
        generatedSqlQuery: queryEntity.generatedSqlQuery,
        data: queryEntity.data,
        // queryEntity.outputType === 'descriptive'
        //   ? queryEntity.data
        //   : JSON.parse(queryEntity.data), // parse if outputType is not descriptive
        createdAt: queryEntity.createdAt,
        updatedAt: queryEntity.updatedAt,
      };
      return {
        statusCode: save ? HttpStatus.CREATED : HttpStatus.OK,
        message: save
          ? 'Query executed and saved successfully'
          : 'Query executed successfully',
        data: result,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Failed to run direct query: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to execute query: ${error.message}`,
      );
    }
  }

  async execute(executeQueryDto: ExecuteQueryDto, userId: number) {
    try {
      const database = await this.queryRepo.query(
        `SELECT * FROM databases WHERE "id"=$1 AND "userId"=$2`,
        [executeQueryDto.databaseId, userId],
      );

      if (!database.length) {
        throw new NotFoundException('Database not found');
      }

      const password = await this.encryptionService.decrypt(
        database[0].password,
      );
      const { host, username, name, port, provider } = database[0];

      const dataFromDatabase = await this.executeSqlQuery(
        executeQueryDto.sqlQuery,
        host,
        username,
        password,
        name,
        port,
        provider,
      );

      return {
        Output: dataFromDatabase,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to execute query.');
    }
  }

  async create(userId: number, createQueryDto: CreateQueryDto) {
    try {
      const existingQuery = await this.queryRepo.findOne({
        where: {
          name: createQueryDto.name,
          query: createQueryDto.query,
          outputType: createQueryDto.outputType,
          databaseId: createQueryDto.databaseId,
          userId: userId,
        },
      });
      if (existingQuery) {
        throw new ConflictException('Query already exists');
      }
      const query = this.queryRepo.create({
        name: createQueryDto.name,
        query: createQueryDto.query,
        outputType: createQueryDto.outputType,
        databaseId: createQueryDto.databaseId,
        userId: userId,
      });
      await this.queryRepo.save(query);
      this.logger.log(`Query ${query.id} for user ${userId} saved`);

      return query;
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(
        `Failed to save query for user ${userId} to our database: ${error.message}`,
      );
      throw new BadRequestException(
        `Failed to save query to database: Reason: ${error.message}`,
      );
    }
  }

  async update(
    userId: number,
    queryId: number,
    createQueryDto: CreateQueryDto,
  ) {
    try {
      const query = await this.queryRepo.findOne({
        where: { id: queryId, userId: userId },
      });

      if (!query || query.database.user.id !== userId) {
        throw new BadRequestException('Query not found or unauthorized');
      }

      query.name = createQueryDto.name;
      query.query = createQueryDto.query;
      query.outputType = createQueryDto.outputType;
      query.databaseId = createQueryDto.databaseId;
      await this.queryRepo.save(query);
      this.logger.log(`Query ${queryId} updated for user ${userId}`);

      return 'Query updated successfully';
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Failed to update query for user ${userId}: ${error.message}`,
      );
      throw new InternalServerErrorException('Failed to update query');
    }
  }

  async linkQueryToDashboard(
    userId: number,
    queryId: number,
    dashboardId: number,
  ) {
    try {
      const query = await this.queryRepo.findOne({
        where: { id: queryId },
        relations: ['dashboards'],
      });
      const dashboard = await this.queryRepo.manager.findOne(DashboardEntity, {
        where: { id: dashboardId, userId },
      });

      if (!query || !dashboard) {
        throw new NotFoundException('Query or Dashboard not found');
      }

      query.dashboards.push(dashboard);
      await this.queryRepo.save(query);
      this.logger.log(
        `Query ${queryId} linked to dashboard ${dashboardId} for user ${userId}`,
      );

      return 'Query linked to dashboard successfully';
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to link query to dashboard: ${error.message}`);
      throw new InternalServerErrorException(
        'Failed to link query to dashboard',
      );
    }
  }

  async unlinkQueryFromDashboard(
    userId: number,
    queryId: number,
    dashboardId: number,
  ) {
    try {
      const query = await this.queryRepo.findOne({
        where: { id: queryId, userId },
        relations: ['dashboards'],
      });
      const dashboard = await this.queryRepo.manager.findOne(DashboardEntity, {
        where: { id: dashboardId },
      });

      if (!query || !dashboard) {
        throw new NotFoundException('Query or Dashboard not found');
      }

      query.dashboards = query.dashboards.filter((d) => d.id !== dashboardId);
      await this.queryRepo.save(query);
      this.logger.log(
        `Query ${queryId} remove dfrom dashboard ${dashboardId} for user ${userId}`,
      );
      return 'Query unlinked from dashboard successfully';
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to unlink query from dashboard: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to unlink query from dashboard',
      );
    }
  }

  async runDashboard(dashboardId: number, userId: number) {
    try {
      // fetch all queries that have dashboardId = dashboardId in junction table
      const queries = await this.queryRepo
        .createQueryBuilder('query')
        .innerJoin('query.dashboards', 'dashboard')
        .innerJoin('query.database', 'database')
        .where('dashboard.id = :dashboardId', { dashboardId })
        .andWhere('database.userId = :userId', { userId })
        .getMany();

      if (!queries.length) {
        throw new NotFoundException('No queries found for this dashboard');
      }

      // execute queries in parallel (simuntaneously using multip threading)
      // basically need to runQuery on all of the queries found in the above query parallely.

      const promises = queries.map((query) => this.runQuery(query.id, userId));
      const results = await Promise.all(promises);

      return results;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Couldnt execute queries. Error: ${error.message}`);
      throw new InternalServerErrorException("Couldn't execute queries");
    }
  }
  async getDatabaseQueries(
    databaseId: number,
    userId: number,
    page: number = 1,
    limit: number = 10,
    search: string = '',
  ) {
    try {
      const queryBuilder = this.queryRepo
        .createQueryBuilder('query')
        .select([
          'query.id',
          'query.name',
          'query.query',
          'query.outputType',
          'query.createdAt',
          'query.updatedAt',
          'query.userId',
          'query.databaseId',
        ]);

      queryBuilder.where('query.databaseId = :databaseId', { databaseId });
      queryBuilder.andWhere('query.userId = :userId', { userId });

      if (search) {
        queryBuilder.andWhere(
          '(query.name ILIKE :search OR query.query ILIKE :search)',
          { search: `%${search}%` },
        );
      }

      queryBuilder.skip((page - 1) * limit).take(limit);
      const [queries, count] = await queryBuilder.getManyAndCount();

      return {
        queries,
        count,
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch queries for database ${databaseId}: ${error.message}`,
      );
      throw new InternalServerErrorException("Couldn't fetch queries");
    }
  }

  async getQueryCountForDatabase(databaseId: number, userid: number) {
    try {
      const count = await this.queryRepo.count({
        where: { userId: userid, databaseId: databaseId },
      });
      return { count: count };
    } catch (error) {
      this.logger.error(
        `Failed to fetch count of queries ${databaseId}: ${error.message}`,
      );
      throw new InternalServerErrorException('Couldnt fetch query count');
    }
  }

  async getQueryCountForDashboard(
    dashboardId: number,
  ): Promise<{ count: number }> {
    try {
      const result = await this.queryRepo.query(
        'SELECT COUNT(*)::int AS count FROM dashboard_query',
      );

      return { count: result[0]?.count ?? 0 };
    } catch (error) {
      this.logger.error(
        `Failed to fetch query count for dashboard ${dashboardId}: ${error.message}`,
      );
      throw new InternalServerErrorException("Couldn't fetch query count");
    }
  }

  async getExecutedQueryCount(userId: number): Promise<{ count: number }> {
    try {
      const count = await this.queryRepo.query(
        'SELECT COUNT(*)::int AS count FROM queries WHERE data IS NOT NULL AND "userId" = $1',
        [userId],
      );

      return { count: count[0]?.count ?? 0 };
    } catch (error) {
      this.logger.error(`Failed to fetch query count: ${error.message}`);
      throw new InternalServerErrorException("Couldn't fetch query count");
    }
  }

  async getDashboardQueries(
    dashboardId: number,
    userId: number,
    page: number = 1,
    limit: number = 10,
    search: string = '',
  ) {
    try {
      const queryBuilder = this.queryRepo
        .createQueryBuilder('query')
        .select([
          'query.id',
          'query.name',
          'query.query',
          'query.outputType',
          'query.createdAt',
          'query.updatedAt',
          'query.databaseId',
        ])
        .innerJoin('query.dashboards', 'dashboard')
        .innerJoin('query.database', 'database')
        .where('dashboard.id = :dashboardId', { dashboardId })
        .andWhere('database.userId = :userId', { userId });

      if (search) {
        queryBuilder.andWhere(
          '(query.name ILIKE :search OR query.query ILIKE :search)',
          { search: `%${search}%` },
        );
      }

      const [queries, count] = await queryBuilder
        .skip((page - 1) * limit)
        .take(limit)
        .getManyAndCount();

      return { queries, count };
    } catch (error) {
      this.logger.error(
        `Failed to fetch queries for dashboard ${dashboardId}: ${error.message}`,
      );
      throw new InternalServerErrorException("Couldn't fetch queries");
    }
  }

  async remove(id: number, userId: number) {
    try {
      const query = await this.queryRepo.findOne({
        where: { id },
        relations: ['database'],
      });

      if (!query || query.database.userId !== userId) {
        throw new ForbiddenException('Unauthorized to delete this query');
      }
      await this.queryRepo.delete(id);
      this.logger.log(`Query ${id} deleted for user ${userId}`);
      return 'Query and related dashboard entries deleted successfully';
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Failed to delete query ${id}: ${error.message}`);
      throw new InternalServerErrorException('Failed to delete query');
    }
  }

  async suggestQueries(databaseId: number, userId: number) {
    // use llm suggestedQueriesPrompt to generate 10 queries

    try {
      const schemaQuery = await this.queryRepo
        .createQueryBuilder('query')
        .innerJoin('query.database', 'database')
        .where('database.id = :databaseId', { databaseId })
        .select('database.schema', 'schema')
        .getRawOne();

      const schema = schemaQuery?.schema;
      const openai = new OpenAI({
        apiKey: this.OPENAI_API_KEY,
      });
      const prompt = `
        Schema: ${schema}`;

      const response = await openai.chat.completions.create({
        model: this.OPENAI_MODEL,
        temperature: this.OPENAI_TEMPERATURE,
        messages: [
          { role: 'system', content: QueryPrompts.suggestedQueriesPrompt },
          { role: 'user', content: prompt },
        ],
      });
      const generatedQueries =
        response.choices[0].message.content?.trim() ?? '';
      this.logger.log(`Queries for database ${databaseId} generated`);
      return generatedQueries;
    } catch (error) {
      if (
        error.constructor.name === 'APIConnectionError' ||
        error.message.includes('Connection error') ||
        error.cause?.code === 'EAI_AGAIN' ||
        error.cause?.errno === 'EAI_AGAIN'
      ) {
        throw new HttpException(
          'Network issue connecting to AI service.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      this.logger.error(`Failed to generate queries: ${error.message}`);
      throw new InternalServerErrorException('Couldnt generate queries');
    }
  }
  // async generateMappings() {

  //   const schema = `{"metadata":{"totalTables":8,"totalColumns":50},"schema":{"users":{"columns":[{"name":"email","type":"character varying","isPrimary":false,"isNullable":false,"isUnique":true},{"name":"password","type":"character varying","isPrimary":false,"isNullable":false},{"name":"name","type":"character varying","isPrimary":false,"isNullable":false},{"name":"updatedAt","type":"timestamp without time zone","isPrimary":false,"isNullable":false},{"name":"createdAt","type":"timestamp without time zone","isPrimary":false,"isNullable":false},{"name":"id","type":"integer","isPrimary":true,"isNullable":false}]},"queries":{"columns":[{"name":"userId","type":"integer","isPrimary":false,"isNullable":false},{"name":"createdAt","type":"timestamp without time zone","isPrimary":false,"isNullable":false},{"name":"updatedAt","type":"timestamp without time zone","isPrimary":false,"isNullable":false},{"name":"name","type":"character varying","isPrimary":false,"isNullable":false},{"name":"outputType","type":"character varying","isPrimary":false,"isNullable":false},{"name":"query","type":"character varying","isPrimary":false,"isNullable":false},{"name":"data","type":"character varying","isPrimary":false},{"name":"generatedSqlQuery","type":"character varying","isPrimary":false},{"name":"id","type":"integer","isPrimary":true,"isNullable":false},{"name":"databaseId","type":"integer","isPrimary":false,"isNullable":false}],"foreignKeys":[{"columnName":"userId","referencedTableName":"users","referencedColumnName":"id"},{"columnName":"databaseId","referencedTableName":"databases","referencedColumnName":"id"}]},"dashboards":{"columns":[{"name":"id","type":"integer","isPrimary":true,"isNullable":false},{"name":"updatedAt","type":"timestamp without time zone","isPrimary":false,"isNullable":false},{"name":"databaseId","type":"integer","isPrimary":false,"isNullable":false},{"name":"createdAt","type":"timestamp without time zone","isPrimary":false,"isNullable":false},{"name":"description","type":"character varying","isPrimary":false,"isNullable":false},{"name":"name","type":"character varying","isPrimary":false,"isNullable":false},{"name":"userId","type":"integer","isPrimary":false,"isNullable":false}],"foreignKeys":[{"columnName":"userId","referencedTableName":"users","referencedColumnName":"id"},{"columnName":"databaseId","referencedTableName":"databases","referencedColumnName":"id"}]},"tags":{"columns":[{"name":"id","type":"integer","isPrimary":true,"isNullable":false},{"name":"name","type":"character varying","isPrimary":false,"isNullable":false,"isUnique":true}]},"taggable":{"columns":[{"name":"id","type":"integer","isPrimary":true,"isNullable":false},{"name":"tagId","type":"integer","isPrimary":false,"isNullable":false},{"name":"entityId","type":"integer","isPrimary":false,"isNullable":false},{"name":"entityType","type":"character varying","isPrimary":false,"isNullable":false}],"foreignKeys":[{"columnName":"tagId","referencedTableName":"tags","referencedColumnName":"id"}]},"dashboard_query":{"columns":[{"name":"dashboardId","type":"integer","isPrimary":true,"isNullable":false},{"name":"queryId","type":"integer","isPrimary":true,"isNullable":false}],"foreignKeys":[{"columnName":"queryId","referencedTableName":"queries","referencedColumnName":"id"},{"columnName":"dashboardId","referencedTableName":"dashboards","referencedColumnName":"id"}]},"databases":{"columns":[{"name":"password","type":"character varying","isPrimary":false,"isNullable":false},{"name":"userId","type":"integer","isPrimary":false,"isNullable":false},{"name":"connectionName","type":"character varying","isPrimary":false},{"name":"id","type":"integer","isPrimary":true,"isNullable":false},{"name":"createdAt","type":"timestamp without time zone","isPrimary":false,"isNullable":false},{"name":"host","type":"character varying","isPrimary":false,"isNullable":false},{"name":"description","type":"character varying","isPrimary":false},{"name":"provider","type":"character varying","isPrimary":false,"isNullable":false},{"name":"username","type":"character varying","isPrimary":false,"isNullable":false},{"name":"name","type":"character varying","isPrimary":false,"isNullable":false},{"name":"updatedAt","type":"timestamp without time zone","isPrimary":false,"isNullable":false},{"name":"port","type":"integer","isPrimary":false,"isNullable":false},{"name":"schema","type":"character varying","isPrimary":false}],"foreignKeys":[{"columnName":"userId","referencedTableName":"users","referencedColumnName":"id"}]},"dashboard_query_positions":{"columns":[{"name":"x","type":"integer","isPrimary":false,"isNullable":false},{"name":"y","type":"integer","isPrimary":false,"isNullable":false},{"name":"queryId","type":"integer","isPrimary":true,"isNullable":false},{"name":"dashboardId","type":"integer","isPrimary":true,"isNullable":false},{"name":"z","type":"integer","isPrimary":false,"isNullable":false},{"name":"h","type":"integer","isPrimary":false,"isNullable":false}],"foreignKeys":[{"columnName":"dashboardId","referencedTableName":"dashboards","referencedColumnName":"id"},{"columnName":"queryId","referencedTableName":"queries","referencedColumnName":"id"}]}}}`
  //   const openai = new OpenAI({
  //     apiKey: OPENAI_API_KEY,
  //   });
  //   const prompt = `
  //     Schema: ${schema}`;

  //   const response = await openai.chat.completions.create({
  //     model: OPENAI_MODEL,
  //     temperature: OPENAI_TEMPERATURE,
  //     messages: [
  //       { role: 'system', content: QueryPrompts.generateMappings },
  //       { role: 'user', content: prompt },
  //     ],
  //   });
  //   const mappings =
  //     response.choices[0].message.content?.trim() ?? '';
  //   return mappings;

  // }

  async getQueryInsights(
    queryId: number,
    userId: number,
    search: boolean,
    customInstructions: string,
  ) {
    try {
      const query = await this.queryRepo.findOne({
        where: { id: queryId, userId },
      });

      if (!query) {
        throw new BadRequestException('Query not found or unauthorized');
      }

      const { query: userQuery, generatedSqlQuery, outputType, data } = query;
      const openai = new OpenAI({
        apiKey: this.OPENAI_API_KEY,
      });

      let prompt = `
        User Query: ${userQuery}
        Output Type: ${outputType}
        Generated SQL Query : ${generatedSqlQuery}
        Data From Database: ${JSON.stringify(data)}`;

      if (search) {
        prompt += QueryPrompts.insightsPromptUseWeb;
      }

      if (customInstructions) {
        prompt += `\nCustom User Instructions: ${customInstructions}`;
      }

      const response = await openai.chat.completions.create({
        model: this.OPENAI_MODEL,
        temperature: this.OPENAI_TEMPERATURE,
        messages: [
          { role: 'system', content: QueryPrompts.insightsPrompt },
          { role: 'user', content: prompt },
        ],
      });

      const insights = response.choices[0].message.content?.trim() ?? '';
      this.logger.log(
        `Insights on query ${queryId} for user ${userId} generated`,
      );
      return { insights: insights };
    } catch (error) {
      if (
        error.constructor.name === 'APIConnectionError' ||
        error.message.includes('Connection error') ||
        error.cause?.code === 'EAI_AGAIN' ||
        error.cause?.errno === 'EAI_AGAIN'
      ) {
        throw new HttpException(
          'Network issue connecting to AI service.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to get insights: ${error.message}`);
      throw new InternalServerErrorException('Failed to get insights');
    }
  }

  async generateDashboard(databaseId: number, userId: number) {
    try {
      // step 1: generate a bunch of queries
      const schemaQuery = await this.queryRepo.query(
        `SELECT * FROM databases WHERE "id" = $1;`,
        [databaseId],
      );

      const schema = schemaQuery[0].schema;
      const openai = new OpenAI({
        apiKey: this.OPENAI_API_KEY,
      });
      const prompt = `
        Database Schema: ${schema}`;

      const response = await openai.chat.completions.create({
        model: this.OPENAI_MODEL,
        temperature: this.OPENAI_TEMPERATURE,
        messages: [
          { role: 'system', content: QueryPrompts.sampleDashboardPrompt },
          { role: 'user', content: prompt },
        ],
      });
      const output = response.choices[0].message.content?.trim() ?? '';
      const parsedOutput = JSON.parse(output);

      // step 2: save the queries:
      const queries = JSON.parse(output).queries;
      const ids: number[] = [];
      for (const query of queries) {
        const data = await this.create(userId, {
          name: query.name,
          query: query.query,
          outputType: query.outputType,
          databaseId: databaseId,
        });
        ids.push(data.id);
      }

      // step 3: create a dashboard
      await this.dashboardService.create(userId, {
        name: parsedOutput.name,
        description: parsedOutput.description,
        databaseId: databaseId,
        tags: parsedOutput.tags,
      });

      // step 4: link queries to dashboard
      const dashboard = await this.queryRepo.query(
        `SELECT * FROM dashboards WHERE "name" = $1;`,
        [parsedOutput.name],
      );
      const dashboardId = dashboard[0].id;
      for (const id of ids) {
        await this.linkQueryToDashboard(userId, id, dashboardId);
      }

      // step 5: parallel execute all queries
      await Promise.all(ids.map((id) => this.runQuery(id, userId)));
      this.logger.log(`Generatd sample dashboard for user ${userId}`);
      return 'Sample dashboard generated successfully';
    } catch (error) {
      if (
        error.constructor.name === 'APIConnectionError' ||
        error.message.includes('Connection error') ||
        error.cause?.code === 'EAI_AGAIN' ||
        error.cause?.errno === 'EAI_AGAIN'
      ) {
        throw new HttpException(
          'Network issue connecting to AI service.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      this.logger.error(
        `Failed to generate sample dashboard: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Couldnt generate sample dashboard',
      );
    }
  }

  async getQueryDataAsJson(queryId: number, userId: number) {
    try {
      const result = await this.queryRepo.query(
        `SELECT * FROM queries WHERE id = $1 AND "userId" = $2`,
        [queryId, userId],
      );

      if (!result || result.length === 0) {
        throw new NotFoundException(
          `Query with id ${queryId} not found or you don't have access to it`,
        );
      }

      // Get the data from the result
      const rawData = result[0].data;

      // If no data, return empty array
      if (!rawData) {
        return [];
      }

      // Try to directly return the data if it's already in proper format
      this.logger.log(`Generated JSON data for qurey ${queryId}`);
      return rawData;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(
        `Error processing query data: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to process query data');
    }
  }

  async getQueryDataAsCsv(queryId: number, userId: number) {
    try {
      const query = await this.queryRepo.findOne({
        where: { id: queryId, userId: userId },
      });
      if (!query) {
        throw new NotFoundException('Query not found or access denied');
      }

      const data = query.data;
      const parsedData = JSON.parse(data);

      let converter = require('json-2-csv');
      const csv = await converter.json2csv(parsedData);
      this.logger.log(`Generated CSV data for qurey ${queryId}`);

      return csv;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error generating CSV: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to generate CSV');
    }
  }

  async findOne(id: number, userId: number) {
    try {
      const query = await this.queryRepo.findOne({
        where: { id, userId },
      });

      if (!query) {
        throw new NotFoundException('Query not found or unauthorized');
      }

      if (query.outputType !== 'descriptive') {
        query.data = JSON.parse(query.data);
      }
      return query;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to fetch query ${id}: ${error.message}`);
      throw new InternalServerErrorException('Failed to fetch query');
    }
  }
}
