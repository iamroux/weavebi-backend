import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CreateUserdbDto } from './dto/create-userdb.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { SSLMode, UserdbEntity } from './entities/userdb.entity';
import {
  DataSource,
  DataSourceOptions,
  Repository,
  Table,
  TableColumn,
  TableForeignKey,
} from 'typeorm';
import { UpdateUserdbDto } from './dto/update-userdb.dto';
import { getSSLConfig, mapProviderToTypeORM } from 'src/common/database-utils';

// Additional interfaces for schema
interface RelationshipMap {
  [tableName: string]: Array<{
    type: 'hasMany' | 'belongsTo';
    table: string;
    foreignKey: string;
    localKey: string;
  }>;
}

interface SchemaResult {
  metadata: SchemaMetadata;
  schema: Schema;
  context: string; // LLM-friendly context
}

interface SchemaMetadata {
  databaseType: string;
  totalTables: number;
  totalColumns: number;
}

interface Schema {
  [tableName: string]: TableInfo;
}

interface TableInfo {
  columns: ColumnInfo[];
  foreignKeys?: ForeignKeyInfo[];
}

interface ColumnInfo {
  name: string;
  type: string;
  isPrimary: boolean;
  isNullable?: boolean;
  isUnique?: boolean;
  default?: string;
}

interface ForeignKeyInfo {
  columnName: string;
  referencedTableName: string;
  referencedColumnName: string;
}

@Injectable()
export class UserdbService {
  private readonly logger = new Logger(UserdbService.name);

  constructor(
    @InjectRepository(UserdbEntity)
    private readonly userDbRepo: Repository<UserdbEntity>,
  ) {}



  // Optimized schema extraction
  async getSchema(
    provider: 'mysql' | 'mariadb' | 'postgres' | 'mssql' | 'oracle',
    host: string,
    port: number,
    username: string,
    password: string,
    database: string,
    ssl: SSLMode = SSLMode.DISABLE
      
  ): Promise<SchemaResult> {
    try {
      const typeormProvider = mapProviderToTypeORM(provider);
      const options: DataSourceOptions = {
        type: typeormProvider,
        host,
        port,
        username,
        password,
        database,
        ssl: getSSLConfig(ssl),

      }
      const tempDataSource = new DataSource(options);
   

      try {
        await tempDataSource.initialize();
      } catch (initError) {
        this.handleConnectionError(initError);
      }

      const queryRunner = tempDataSource.createQueryRunner();

      try {
        const tables = await queryRunner.getTables();
        const schema: Schema = {};
        const relationships: RelationshipMap = {}; // Track relationships for LLM context

        // Filter out system tables
        const filteredTables = this.filterSystemTables(tables, provider);

        // Process each table
        for (const table of filteredTables) {
          // Normalize column information for LLM understanding
          const columns = this.normalizeColumns(table.columns, provider);

          // Standardize foreign key formats across all DB types
          const foreignKeys = this.normalizeForeignKeys(table.foreignKeys);

          // Track relationships for clearer LLM context
          this.trackRelationships(relationships, table.name, foreignKeys);

          // Add normalized table to schema
          schema[table.name] = {
            columns,
            ...(foreignKeys.length > 0 && { foreignKeys }),
          };
        }

        await queryRunner.release();
        await tempDataSource.destroy();

        // Generate LLM-friendly context
        const schemaContext = this.generateLLMContext(
          schema,
          relationships,
          provider,
        );

        this.logger.log(`Schema for database ${database} generated`)

        return {
          metadata: {
            databaseType: provider,
            totalTables: Object.keys(schema).length,
            totalColumns: Object.values(schema).reduce(
              (acc, table) => acc + table.columns.length,
              0,
            ),
          },
          schema,
          context: schemaContext, // LLM-specific context for better query generation
        };
      } catch (tablesError) {
        throw new BadRequestException('Schema extraction failed', {
          description: `Unable to retrieve database tables: ${tablesError.message}`,
          cause: tablesError,
        });
      } finally {
        // Ensure resources are released
        try {
          if(queryRunner)
          {await queryRunner.release();}
          if(tempDataSource && tempDataSource.isInitialized){
          await tempDataSource.destroy();}
        } catch (cleanupError) {
          this.logger.warn(`Resource cleanup error: ${cleanupError.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Unexpected schema extraction error: ${error.message}`);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException('Unexpected database schema error', {
        description:
          'Failed to extract database schema due to an unexpected error',
        cause: error,
      });
    }
  }

  // Handle connection errors with standardized messaging
  private handleConnectionError(initError: any): never {
    if (
      initError.code === '28P01' ||
      initError.code === '28000' ||
      initError.message?.includes('authentication')
    ) {
      throw new BadRequestException('Authentication failed', {
        description: 'Invalid username or password for database connection',
      });
    }

    if (
      initError.code === '3D000' ||
      initError.code === '42000' ||
      (initError.message?.includes('database') &&
        initError.message?.includes('not exist'))
    ) {
      throw new BadRequestException('Database access error', {
        description: 'Specified database does not exist or cannot be accessed',
      });
    }

    if (
      initError.code === '08001' ||
      initError.code === '08006' ||
      (initError.message?.includes('connect') &&
        initError.message?.includes('failed'))
    ) {
      throw new BadRequestException('Connection failed', {
        description: 'Unable to establish a connection to the database server',
      });
    }

    throw new BadRequestException('Database connection error', {
      description: `Failed to initialize database connection: ${initError.message}`,
      cause: initError,
    });
  }

  // Filter out system tables based on database provider
  private filterSystemTables(tables: Table[], provider: string): Table[] {
    const systemSchemas = [
      'information_schema',
      'sys',
      'performance_schema',
      'mysql',
      'pg_catalog',
      'SYS',
      'SYSTEM',
      'CTXSYS',
      'MDSYS',
      'DBSNMP',
      'tempdb',
      'model',
      'msdb',
      'master',
    ];

    const systemTablePatterns = [
      /^pg_/,
      /^_pg_/,
      /^sqlite_/,
      /^sys/,
      /^APEX_/,
      /^FLOWS_/,
      /^msreplication_/,
      /^spt_/,
      /^sysdtslog/,
    ];

    return tables.filter((table) => {
      // Skip tables in system schemas
      if (systemSchemas.includes(table.schema ?? '')) {
        return false;
      }

      // Skip tables with system naming patterns
      return !systemTablePatterns.some((pattern) => pattern.test(table.name));
    });
  }

  // Normalize column information for consistency across database types
  private normalizeColumns(
    columns: TableColumn[],
    provider: string,
  ): ColumnInfo[] {
    return columns.map((col) => {
      // Normalize type names for consistency
      const normalizedType = this.normalizeDataType(col.type, provider);

      // Build column info with only essential properties
      const columnInfo: ColumnInfo = {
        name: col.name,
        type: normalizedType,
        isPrimary: col.isPrimary,
      };

      // Only include constraints that matter for query generation
      if (!col.isNullable) {
        columnInfo.isNullable = false;
      }

      if (col.isUnique) {
        columnInfo.isUnique = true;
      }

      // Include default values if they exist
      if (col.default !== undefined && col.default !== null) {
        columnInfo.default = this.normalizeDefaultValue(col.default);
      }

      return columnInfo;
    });
  }
  // Normalize data types across different database providers
  private normalizeDataType(type: string, provider: string): string {
    // Extract base type without size/precision
    const baseType = type.split('(')[0].toLowerCase();

    // Map provider-specific types to standard SQL types
    const typeMap: Record<string, Record<string, string>> = {
      mysql: {
        int: 'integer',
        varchar: 'varchar',
        datetime: 'timestamp',
        'tinyint(1)': 'boolean',
      },
      postgres: {
        int4: 'integer',
        int8: 'bigint',
        varchar: 'varchar',
        timestamptz: 'timestamp',
        bool: 'boolean',
      },
      oracle: {
        number: 'numeric',
        varchar2: 'varchar',
        date: 'timestamp',
      },
      mssql: {
        nvarchar: 'varchar',
        datetime: 'timestamp',
        bit: 'boolean',
      },
    };

    // Return normalized type if available, otherwise return the base type
    return typeMap[provider]?.[baseType] || baseType;
  }
  // Standardize default values
  private normalizeDefaultValue(defaultValue: any): string {
    if (defaultValue === null) {
      return 'NULL';
    }

    if (typeof defaultValue === 'string') {
      // Clean up function calls and standardize formatting
      return defaultValue.replace(
        /^(nextval\(|now\(|uuid_generate_v4\().*\)$/,
        'AUTO_GENERATED',
      );
    }

    return String(defaultValue);
  }

  // Normalize foreign keys for consistency
  private normalizeForeignKeys(
    foreignKeys: TableForeignKey[],
  ): ForeignKeyInfo[] {
    return foreignKeys.map((fk) => ({
      columnName: fk.columnNames[0],
      referencedTableName: fk.referencedTableName,
      referencedColumnName: fk.referencedColumnNames[0],
    }));
  }

  // Track relationships between tables for LLM context
  private trackRelationships(
    relationships: RelationshipMap,
    tableName: string,
    foreignKeys: ForeignKeyInfo[],
  ): void {
    if (!relationships[tableName]) {
      relationships[tableName] = [];
    }

    for (const fk of foreignKeys) {
      // Add "has many" relationship
      if (!relationships[fk.referencedTableName]) {
        relationships[fk.referencedTableName] = [];
      }

      relationships[fk.referencedTableName].push({
        type: 'hasMany',
        table: tableName,
        foreignKey: fk.columnName,
        localKey: fk.referencedColumnName,
      });

      // Add "belongs to" relationship
      relationships[tableName].push({
        type: 'belongsTo',
        table: fk.referencedTableName,
        foreignKey: fk.columnName,
        localKey: fk.referencedColumnName,
      });
    }
  }

  // Generate LLM-friendly context string
  private generateLLMContext(
    schema: Schema,
    relationships: RelationshipMap,
    provider: string,
  ): string {
    let context = `Database Type: ${provider}\n\n`;
    context += `Table Summary:\n`;

    // Add table information in a format that's easy for LLMs to understand
    Object.entries(schema).forEach(([tableName, tableInfo]) => {
      context += `\nTable: ${tableName}\n`;

      // Primary key information
      const primaryKeys = tableInfo.columns
        .filter((col) => col.isPrimary)
        .map((col) => col.name);

      if (primaryKeys.length > 0) {
        context += `Primary Key(s): ${primaryKeys.join(', ')}\n`;
      }

      // Important columns (adding semantic meaning)
      context += `Columns:\n`;
      tableInfo.columns.forEach((col) => {
        let colDescription = `  - ${col.name} (${col.type})`;

        if (col.isPrimary) {
          colDescription += ` PRIMARY KEY`;
        }

        if (col.isUnique) {
          colDescription += ` UNIQUE`;
        }

        if (col.isNullable === false) {
          colDescription += ` NOT NULL`;
        }

        context += `${colDescription}\n`;
      });

      // Relationships in natural language
      if (relationships[tableName] && relationships[tableName].length > 0) {
        context += `Relationships:\n`;
        relationships[tableName].forEach((rel) => {
          if (rel.type === 'hasMany') {
            context += `  - One ${tableName} has many ${rel.table} (via ${rel.table}.${rel.foreignKey})\n`;
          } else if (rel.type === 'belongsTo') {
            context += `  - Each ${tableName} belongs to one ${rel.table} (via ${tableName}.${rel.foreignKey})\n`;
          }
        });
      }
    });
    return context;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  // Create a new database connection
  async create(userId: number, createUserdbDto: CreateUserdbDto) {
    try {
      const existingDatabase = await this.userDbRepo.findOne({
        where: {
          userId: userId,
          name: createUserdbDto.name,
          provider: createUserdbDto.provider,
          host: createUserdbDto.host,
          port: createUserdbDto.port,
          username: createUserdbDto.username,
        },
      });

      if (existingDatabase) {
        throw new ConflictException('Database already exists');
      }

      // Get the schema of the database
      const schema = await this.getSchema(
        createUserdbDto.provider as
          | 'mysql'
          | 'mariadb'
          | 'postgres'
          | 'mssql'
          | 'oracle',
        createUserdbDto.host,
        createUserdbDto.port,
        createUserdbDto.username,
        createUserdbDto.password,
        createUserdbDto.name,
        createUserdbDto.ssl
      );

      if (!schema || typeof schema !== 'object') {
        throw new BadRequestException('Database schema not found');
      }

      // Save to database using only existing fields in the entity
      const newDatabase = this.userDbRepo.create({
        ...createUserdbDto,
        userId: userId,
        schema: JSON.stringify(schema),
      });

      await this.userDbRepo.save(newDatabase);
      this.logger.log(`Database ${newDatabase.id} saved`)
      return 'Database added successfully';
    } catch (error) {
      this.logger.error(
        `Failed to save user ${userId}'s database to our database: ${error.message}`,
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof ConflictException) {
        throw error;
      }
      if (error.code === '28P01' || error.code === '28000') {
        throw new BadRequestException('Authentication failed', {
          description: 'Invalid username or password',
        });
      }

      if (error.code === '3D000' || error.code === '42000') {
        throw new BadRequestException('Database access error', {
          description: 'Database does not exist or cannot be accessed',
        });
      }

      if (error.code === '08001' || error.code === '08006') {
        throw new BadRequestException('Connection failed', {
          description:
            'Unable to establish a connection to the database server',
        });
      }

      throw new BadRequestException('Database connection failed', {
        cause: error,
        description: 'Unable to add the database connection',
      });
    }
  }

  async findAll(userId: number, page: number, limit: number, search: string, sortBy: string = 'createdAt', sortOrder: 'ASC' | 'DESC' = 'DESC') {
    try {
      const queryBuilder = this.userDbRepo
        .createQueryBuilder('userdb')
        .where('userdb.userId = :userId', { userId });

      if (search) {
        queryBuilder.andWhere(
          '(userdb.name ILIKE :search OR userdb.host ILIKE :search)',
          { search: `%${search}%` },
        );
      }

      const validSortFields = ['createdAt', 'updatedAt'];
      const validSortBy = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
      const validSortOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';

      queryBuilder.orderBy(`userdb.${validSortBy}`, validSortOrder);

      const [databases, count] = await queryBuilder
        .skip((page - 1) * limit)
        .take(limit)
        .select([
          'userdb.connectionName',
          'userdb.description',
          'userdb.id',
          'userdb.name',
          'userdb.provider',
          'userdb.username',
          'userdb.host',
          'userdb.port',
          'userdb.createdAt',
          'userdb.updatedAt',
          'userdb.userId',
          'userdb.ssl',
        ])
        .getManyAndCount();

      return { databases, count };
    } catch (error) {
      this.logger.error(
        `Failed to retrieve user ${userId}'s databases: ${error.message}`,
      );
      throw new InternalServerErrorException('Failed to retrieve databases');
    }
  }

  async test(userId: number, createUserdbDto: CreateUserdbDto) {
    try {
      // Convert provider to TypeORM's expected type
      const typeormProvider = mapProviderToTypeORM(
        createUserdbDto.provider as 'mysql' | 'mariadb' | 'postgres' | 'mssql' | 'oracle'
      );
      
      const tempDataSource = new DataSource({
        type: typeormProvider,
        host: createUserdbDto.host,
        port: createUserdbDto.port,
        username: createUserdbDto.username,
        password: createUserdbDto.password,
        database: createUserdbDto.name,
        ssl: getSSLConfig(createUserdbDto.ssl || SSLMode.DISABLE)
      });
      
      try {
        await tempDataSource.initialize();
      } catch (initError) {
        // Handle specific connection initialization errors
        if (initError.code === '28P01' || initError.code === '28000') {
          throw new BadRequestException('Authentication failed', {
            description: 'Invalid username or password',
          });
        }

        if (initError.code === '3D000' || initError.code === '42000') {
          throw new BadRequestException('Database access error', {
            description: 'Database does not exist or cannot be accessed',
          });
        }

        if (initError.code === '08001' || initError.code === '08006') {
          throw new BadRequestException('Connection failed', {
            description:
              'Unable to establish a connection to the database server',
          });
        }

        throw new BadRequestException('Connection initialization failed', {
          description: `Failed to initialize database connection: ${initError.message}`,
          cause: initError,
        });
      }

      const queryRunner = tempDataSource.createQueryRunner();

      try {
        await queryRunner.query('SELECT 1');
      } catch (queryError) {
        throw new BadRequestException('Query execution failed', {
          description: 'Unable to run test query on the database',
          cause: queryError,
        });
      } finally {
        try {
          await queryRunner.release();
          await tempDataSource.destroy();
        } catch (cleanupError) {
          this.logger.warn(
            `Connection test cleanup error: ${cleanupError.message}`,
          );
        }
      }

      return 'Connection is OK';
    } catch (error) {
      this.logger.error(`Failed to test connection: ${error.message}`);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException('Connection test failed', {
        description: 'Unable to verify database connection',
        cause: error,
      });
    }
  }

  async getCount(userId: number) {
    try {
      const result = await this.userDbRepo.query(`
        SELECT
          COUNT(d.id) AS "totalCount",
          SUM(CASE WHEN EXISTS (
            SELECT 1 FROM queries q WHERE q."databaseId" = d.id
          ) THEN 1 ELSE 0 END) AS "activeCount"
        FROM databases d
        WHERE d."userId" = $1
      `, [userId]);
  
      if (result.length === 0) {
        return { totalCount: 0, activeCount: 0, inactiveCount: 0 };
      }
      
      // Ensure null counts return zero
      const { totalCount = 0, activeCount = 0 } = result[0];
      const parsedTotalCount = parseInt(totalCount, 10);
      const parsedActiveCount = parseInt(activeCount, 10);
      
      return {
        totalCount: parsedTotalCount,
        activeCount: parsedActiveCount,
        inactiveCount: parsedTotalCount - parsedActiveCount
      };
    } catch (error) {
      this.logger.error(`Failed to retrieve database count for user ${userId}: ${error.message}`);
      throw new InternalServerErrorException('Failed to retrieve database count');
    }
  }
  
  

  async update(userId: number, id: number, updateUserdbDto: UpdateUserdbDto) {
    try {
      const existingDatabase = await this.userDbRepo.findOne({
        where: {
          id: id,
          userId: userId,
        },
      });

      if (!existingDatabase) {
        throw new BadRequestException('Database not found');
      }

      // Get the schema of the database
      const schema = await this.getSchema(
        updateUserdbDto.provider as 'mysql' | 'mariadb' | 'postgres' | 'mssql',
        updateUserdbDto.host || '',
        updateUserdbDto.port || 0,
        updateUserdbDto.username || '',
        updateUserdbDto.password || '',
        updateUserdbDto.name || '',
        updateUserdbDto.ssl || SSLMode.DISABLE
      );

      // Update the database entry with the new schema and other provided details
      const updatedDatabase = this.userDbRepo.merge(existingDatabase, {
        ...updateUserdbDto,
        schema: JSON.stringify(schema),
      });

      await this.userDbRepo.save(updatedDatabase);
      this.logger.log(`Database ${id} for user ${userId} updated`)
      return 'Database updated successfully';
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Failed to update user ${userId}'s database: ${error.message}`,
      );
      throw new InternalServerErrorException('Failed to update database');
    }
  }

  async findOne(userId: number, id: number) {
    try {
      const database = await this.userDbRepo.findOne({
        where: {
          id: id,
          userId: userId,
        },
        select: [
          'id',
          'name',
          'provider',
          'username',
          'host',
          'port',
          'createdAt',
          'updatedAt',
          'userId',
          'connectionName',
          'description',
          'ssl'
        ],
      });

      if (!database) {
        throw new BadRequestException('Database not found');
      }

      return database;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve user ${userId}'s database: ${error.message}`,
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to retrieve database');
    }
  }

  async remove(userId: number, id: number) {
    try {
      const database = await this.userDbRepo.findOne({
        where: {
          id: id,
          userId: userId,
        },
      });

      if (!database) {
        throw new BadRequestException('Database not found');
      }

      await this.userDbRepo.remove(database);
      this.logger.log(`Database ${id} for user ${userId} deleted`)
      return 'Database deleted successfully';
    } catch (error) {
      this.logger.error(
        `Failed to delete user ${userId}'s database: ${error.message}`,
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete database');
    }
  }
}
