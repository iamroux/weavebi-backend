import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
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

// Global Constants
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = 'gpt-4o-mini';
const OPENAI_TEMPERATURE = 0;

// now i am become death

@Injectable()
export class QueryService {
  private readonly logger = new Logger(QueryService.name);

  constructor(
    @InjectRepository(QueryEntity)
    private queryRepo: Repository<QueryEntity>,
  ) {}

  // Helper method to generate SQL query using OpenAI
  private async generateSqlQuery(
    promptType: string,
    userQuery: string,
    schema: string,
    provider: string,
    outputType?: string,
  ): Promise<string> {
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    let prompt = `
      Schema: ${schema}
      User Query: ${userQuery}
      Provider: ${provider}`;

    if (outputType) {
      prompt += `\nOutput Type: ${outputType}`;
    }

    try {
      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: OPENAI_TEMPERATURE,
        messages: [
          { role: 'system', content: QueryPrompts.primaryPrompt },
          { role: 'user', content: prompt },
        ],
      });

      const cleanResponse = response.choices[0].message.content?.trim() ?? '';
      this.logger.debug(`Generated SQL query: ${cleanResponse}`);

      // Security check for DML operations (nakli guardrails)
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
        'TRUNCATE'
      ];
      if (
        dmlKeywords.some((keyword) =>
          cleanResponse.toUpperCase().includes(keyword),
        )
      ) {
        this.logger.warn(
          'Generated SQL query contains DML keywords. Query execution blocked',
        );
        return `SELECT 'Query execution blocked. Please contact support for assistance.' as message;`;
      }

      return cleanResponse;
    } catch (error) {
      this.logger.error('Error generating SQL query:', error);
      throw new InternalServerErrorException('Failed to generate SQL query.');
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
  ): Promise<any> {
    let dataSource: DataSource | null = null;

    try {
      dataSource = new DataSource({
        type: provider as 'postgres' | 'mysql' | 'mssql' | 'oracle' | 'mariadb',
        host,
        port,
        username,
        password,
        database,
      });

      await dataSource.initialize();
      return await dataSource.query(sqlQuery);
    } catch (error) {
      this.logger.error(`Failed to execute query: ${error.message}`);
      throw new InternalServerErrorException(
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
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
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
      model: OPENAI_MODEL,
      temperature: OPENAI_TEMPERATURE,
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
      const { host, username, password, name, port, schema, provider } =
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
      queryEntity.data = finalData;
      queryEntity.generatedSqlQuery = generatedSqlQuery;
      await this.queryRepo.save(queryEntity);

      // Return cleaned response
      return {
        id: queryEntity.id,
        name: queryEntity.name,
        query: queryEntity.query,
        outputType: queryEntity.outputType,
        generatedSqlQuery: queryEntity.generatedSqlQuery,
        data: queryEntity.data,
        createdAt: queryEntity.createdAt,
        updatedAt: queryEntity.updatedAt,
      };
    } catch (error) {
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

      const database = await this.queryRepo
        .createQueryBuilder('query')
        .innerJoinAndSelect('query.database', 'database')
        .where('database.id = :databaseId', {
          databaseId: createQueryDto.databaseId,
        })
        .getOne();

      if (!database?.database) {
        throw new NotFoundException('Database not found');
      }

      // Create query entity but don't save yet
      const queryEntity = this.queryRepo.create({
        name: createQueryDto.name,
        query: createQueryDto.query,
        outputType: createQueryDto.outputType,
        databaseId: createQueryDto.databaseId,
        userId: userId,
      });

      // Extract required fields
      const { query, outputType } = queryEntity;
      const { host, username, password, name, port, schema, provider } =
        database.database;

      let finalData: any;
      let generatedSqlQuery: string;

      // Generate SQL and process results based on output type
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

      // Update query entity with results
      queryEntity.data = finalData;
      queryEntity.generatedSqlQuery = generatedSqlQuery;

      // Save if requested
      if (save) {
        await this.queryRepo.save(queryEntity);
      }

      // Return cleaned response
      return {
        id: queryEntity.id,
        name: queryEntity.name,
        query: queryEntity.query,
        outputType: queryEntity.outputType,
        generatedSqlQuery: queryEntity.generatedSqlQuery,
        data: queryEntity.data,
        createdAt: queryEntity.createdAt,
        updatedAt: queryEntity.updatedAt,
      };
    } catch (error) {
      this.logger.error(`Failed to run direct query: ${error.message}`);
      throw error instanceof HttpException
        ? error
        : new InternalServerErrorException(
            `Failed to execute query: ${error.message}`,
          );
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

      return 'Query added successfully';
    } catch (error) {
      this.logger.error(
        `Failed to save query for user ${userId} to our database: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to save query to database',
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
        throw new Error('Query not found or unauthorized');
      }

      query.name = createQueryDto.name;
      query.query = createQueryDto.query;
      query.outputType = createQueryDto.outputType;
      query.databaseId = createQueryDto.databaseId;
      await this.queryRepo.save(query);

      return 'Query updated successfully';
    } catch (error) {
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
        throw new Error('Query or Dashboard not found');
      }

      query.dashboards.push(dashboard);
      await this.queryRepo.save(query);

      return 'Query linked to dashboard successfully';
    } catch (error) {
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
        throw new Error('Query or Dashboard not found');
      }

      query.dashboards = query.dashboards.filter((d) => d.id !== dashboardId);
      await this.queryRepo.save(query);

      return 'Query unlinked from dashboard successfully';
    } catch (error) {
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
      const queryBuilder = this.queryRepo.createQueryBuilder('query');

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

  async getQueryCountForDatabase(databaseId:number, userid:number){
    try {
    const count = await this.queryRepo.count({where: {userId:userid, databaseId:databaseId}})
    return {count: count}
    }
    catch(error){
      this.logger.error(`Failed to fetch count of queries ${databaseId}: ${error.message}`)
      throw new InternalServerErrorException('Couldnt fetch query count')
    }
  }

  async getQueryCountFordashboard(dashboardId ){
    try {
    const count = await this.queryRepo
    .createQueryBuilder('query')
    .innerJoin('query.dashboards', 'dashboard')
    .where('dashboard.id = :dashboardId', { dashboardId })
    .getCount();
    return {count: count};
    }
    catch (error){
      this.logger.error(
        `Failed to fetch query count for dashboard ${dashboardId}: ${error.message}`,
      );
      throw new InternalServerErrorException('Couldnt fetch query count')
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
      return 'Query and related dashboard entries deleted successfully';
    } catch (error) {
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
        apiKey: OPENAI_API_KEY,
      });
      const prompt = `
        Schema: ${schema}`;

      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: OPENAI_TEMPERATURE,
        messages: [
          { role: 'system', content: QueryPrompts.suggestedQueriesPrompt },
          { role: 'user', content: prompt },
        ],
      });
      const generatedQueries =
        response.choices[0].message.content?.trim() ?? '';
      return generatedQueries;
    } catch (error) {
      this.logger.error(`Failed to generate queries: ${error.message}`);
      throw new InternalServerErrorException('Couldnt generate queries');
    }
  }

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

      if (!query || query.database.user.id !== userId) {
        throw new Error('Query not found or unauthorized');
      }

      const { query: userQuery, generatedSqlQuery, outputType, data } = query;
      const openai = new OpenAI({
        apiKey: OPENAI_API_KEY,
      });

      let prompt = `
        User Query: ${userQuery}
        Output Type: ${outputType}
        Generated SQL Query : ${generatedSqlQuery}
        Data From Database: ${JSON.stringify(data)}`;

      if (search) {
        prompt +=
          '\nUse your knowledge and reliable internet sources to analyze and compare this data. Provide additional insights, trends, or actionable suggestions based on the query results and any relevant external information you can find online. Ensure that your insights are well-supported and cite credible sources where applicable.';
      }

      if (customInstructions) {
        prompt += `\nCustom User Instructions: ${customInstructions}`;
      }

      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: OPENAI_TEMPERATURE,
        messages: [
          { role: 'system', content: QueryPrompts.insightsPrompt },
          { role: 'user', content: prompt },
        ],
      });

      const insights = response.choices[0].message.content?.trim() ?? '';
      return insights;
    } catch (error) {
      this.logger.error(`Failed to get insights: ${error.message}`);
      throw new InternalServerErrorException('Failed to get insights');
    }
  }
}
