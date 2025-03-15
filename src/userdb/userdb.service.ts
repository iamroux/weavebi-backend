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
  QueryRunner,
  Repository,
} from 'typeorm';
import { UpdateUserdbDto } from './dto/update-userdb.dto';
import { getSSLConfig, mapProviderToTypeORM } from 'src/common/database-utils';

interface SchemaResult {
  metadata: {
    databaseType: string;
    totalTables: number;
    totalColumns: number;
  };
  schema: {
    [tableName: string]: {
      columns: Array<{
        name: string;
        type: string;
        isPrimary: boolean;
        isNullable?: boolean;
        isUnique?: boolean;
        default?: string;
        enumValues?: string[];
      }>;
      foreignKeys?: Array<{
        columnName: string;
        referencedTableName: string;
        referencedColumnName: string;
      }>;
    };
  };
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
    ssl: SSLMode = SSLMode.DISABLE,
  ): Promise<SchemaResult> {
    const typeormProvider = mapProviderToTypeORM(provider);
    const options: DataSourceOptions = {
      type: typeormProvider,
      host,
      port,
      username,
      password,
      database,
      ssl: getSSLConfig(ssl),
    };
    const tempDataSource = new DataSource(options);

    try {
      await tempDataSource.initialize();
      const queryRunner = tempDataSource.createQueryRunner();

      try {
        // Extract schema using provider-specific queries
        const schema = await this.extractSchemaWithRawQueries(queryRunner, provider);

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
        };
      } finally {
        await queryRunner.release();
        await tempDataSource.destroy();
      }
    } catch (error) {
      this.logger.error(`Schema extraction failed: ${error.message}`);
      throw new BadRequestException('Schema extraction failed', {
        cause: error,
      });
    }
  }

  // Extract schema using raw SQL queries
  private async extractSchemaWithRawQueries(
    queryRunner: QueryRunner,
    provider: string,
  ): Promise<SchemaResult['schema']> {
    switch (provider) {
      case 'mysql':
      case 'mariadb':
        return this.extractMySQLSchema(queryRunner);
      case 'postgres':
        return this.extractPostgresSchema(queryRunner);
      case 'mssql':
        return this.extractMSSQLSchema(queryRunner);
      case 'oracle':
        return this.extractOracleSchema(queryRunner);
      default:
        throw new Error(`Unsupported database provider: ${provider}`);
    }
  }

  // MySQL/MariaDB schema extraction
  private async extractMySQLSchema(queryRunner: QueryRunner): Promise<SchemaResult['schema']> {
    const schema: SchemaResult['schema'] = {};

    // Get tables
    const tables = await queryRunner.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
    `);

    for (const table of tables) {
      const tableName = table.TABLE_NAME;

      // Get columns
      const columns = await queryRunner.query(
        `
        SELECT column_name, data_type, is_nullable, column_key, column_default
        FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ?
      `,
        [tableName],
      );

      // Get foreign keys
      const foreignKeys = await queryRunner.query(
        `
        SELECT column_name, referenced_table_name, referenced_column_name
        FROM information_schema.key_column_usage
        WHERE table_schema = DATABASE() AND table_name = ?
          AND referenced_table_name IS NOT NULL
      `,
        [tableName],
      );

      schema[tableName] = {
        columns: columns.map((col) => ({
          name: col.COLUMN_NAME,
          type: col.DATA_TYPE,
          isPrimary: col.COLUMN_KEY === 'PRI',
          isNullable: col.IS_NULLABLE === 'YES',
          isUnique: col.COLUMN_KEY === 'UNI',
          default: this.normalizeDefaultValue(col.COLUMN_DEFAULT),
        })),
        foreignKeys: foreignKeys
          .filter((fk) => fk.REFERENCED_TABLE_NAME !== tableName) // Remove self-referential FKs
          .map((fk) => ({
            columnName: fk.COLUMN_NAME,
            referencedTableName: fk.REFERENCED_TABLE_NAME,
            referencedColumnName: fk.REFERENCED_COLUMN_NAME,
          })),
      };
    }

    return schema;
  }

  // Postgres schema extraction
  private async extractPostgresSchema(queryRunner: QueryRunner): Promise<SchemaResult['schema']> {
    const schema: SchemaResult['schema'] = {};

    // Get tables
    const tables = await queryRunner.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);

    for (const table of tables) {
      const tableName = table.table_name;

      // Get columns
      const columns = await queryRunner.query(`
        SELECT column_name, data_type, is_nullable, column_default, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `, [tableName]);

      // Get enum values for enum types
      const enumColumns = columns.filter((col) => col.udt_name.startsWith('enum_'));
      const enumValuesMap = new Map<string, string[]>();
      for (const col of enumColumns) {
        const enumValues = await queryRunner.query(`
          SELECT unnest(enum_range(NULL::${col.udt_name})) AS value
        `);
        enumValuesMap.set(col.column_name, enumValues.map((v) => v.value));
      }

      // Get foreign keys
      const foreignKeys = await queryRunner.query(`
        SELECT kcu.column_name, ccu.table_name AS referenced_table_name, ccu.column_name AS referenced_column_name
        FROM information_schema.key_column_usage kcu
        JOIN information_schema.constraint_column_usage ccu
          ON kcu.constraint_name = ccu.constraint_name
        WHERE kcu.table_schema = 'public' AND kcu.table_name = $1
      `, [tableName]);

      schema[tableName] = {
        columns: columns.map((col) => ({
          name: col.column_name,
          type: col.data_type,
          isPrimary: col.is_identity === 'YES',
          isNullable: col.is_nullable === 'YES',
          default: this.normalizeDefaultValue(col.column_default),
          enumValues: enumValuesMap.get(col.column_name), // Add enum values
        })),
        foreignKeys: foreignKeys
          .filter((fk) => fk.referenced_table_name !== tableName) // Remove self-referential FKs
          .map((fk) => ({
            columnName: fk.column_name,
            referencedTableName: fk.referenced_table_name,
            referencedColumnName: fk.referenced_column_name,
          })),
      };
    }

    return schema;
  }

  // MSSQL schema extraction
  private async extractMSSQLSchema(queryRunner: QueryRunner): Promise<SchemaResult['schema']> {
    const schema: SchemaResult['schema'] = {};

    // Get tables
    const tables = await queryRunner.query(`
      SELECT name AS table_name
      FROM sys.tables
    `);

    for (const table of tables) {
      const tableName = table.table_name;

      // Get columns
      const columns = await queryRunner.query(
        `
        SELECT col.name AS column_name, typ.name AS data_type, col.is_nullable, col.is_identity, col.default_value
        FROM sys.columns col
        JOIN sys.types typ ON col.user_type_id = typ.user_type_id
        WHERE col.object_id = OBJECT_ID(?)
      `,
        [tableName],
      );

      // Get foreign keys
      const foreignKeys = await queryRunner.query(
        `
        SELECT fkcol.name AS column_name, pktab.name AS referenced_table_name, pkcol.name AS referenced_column_name
        FROM sys.foreign_key_columns fkc
        JOIN sys.columns fkcol ON fkc.parent_object_id = fkcol.object_id AND fkc.parent_column_id = fkcol.column_id
        JOIN sys.columns pkcol ON fkc.referenced_object_id = pkcol.object_id AND fkc.referenced_column_id = pkcol.column_id
        JOIN sys.tables pktab ON fkc.referenced_object_id = pktab.object_id
        WHERE fkc.parent_object_id = OBJECT_ID(?)
      `,
        [tableName],
      );

      schema[tableName] = {
        columns: columns.map((col) => ({
          name: col.column_name,
          type: col.data_type,
          isPrimary: col.is_identity === 1,
          isNullable: col.is_nullable === 1,
          default: this.normalizeDefaultValue(col.default_value),
        })),
        foreignKeys: foreignKeys
          .filter((fk) => fk.referenced_table_name !== tableName) // Remove self-referential FKs
          .map((fk) => ({
            columnName: fk.column_name,
            referencedTableName: fk.referenced_table_name,
            referencedColumnName: fk.referenced_column_name,
          })),
      };
    }

    return schema;
  }

  // Oracle schema extraction
  private async extractOracleSchema(queryRunner: QueryRunner): Promise<SchemaResult['schema']> {
    const schema: SchemaResult['schema'] = {};

    // Get tables
    const tables = await queryRunner.query(`
      SELECT table_name
      FROM user_tables
    `);

    for (const table of tables) {
      const tableName = table.TABLE_NAME;

      // Get columns
      const columns = await queryRunner.query(`
        SELECT column_name, data_type, nullable, data_default
        FROM user_tab_columns
        WHERE table_name = ?
      `, [tableName]);

      // Get primary keys
      const primaryKeys = await queryRunner.query(`
        SELECT cols.column_name
        FROM user_constraints cons
        JOIN user_cons_columns cols ON cons.constraint_name = cols.constraint_name
        WHERE cons.table_name = ? AND cons.constraint_type = 'P'
      `, [tableName]);

      // Get foreign keys
      const foreignKeys = await queryRunner.query(`
        SELECT a.column_name, c_pk.table_name AS referenced_table_name, c_pk.column_name AS referenced_column_name
        FROM user_cons_columns a
        JOIN user_constraints c ON a.constraint_name = c.constraint_name
        JOIN user_cons_columns c_pk ON c.r_constraint_name = c_pk.constraint_name
        WHERE c.constraint_type = 'R' AND a.table_name = ?
      `, [tableName]);

      schema[tableName] = {
        columns: columns.map((col) => ({
          name: col.COLUMN_NAME,
          type: col.DATA_TYPE,
          isPrimary: primaryKeys.some((pk) => pk.column_name === col.COLUMN_NAME),
          isNullable: col.NULLABLE === 'Y',
          default: this.normalizeDefaultValue(col.DATA_DEFAULT),
        })),
        foreignKeys: foreignKeys
          .filter((fk) => fk.referenced_table_name !== tableName) // Remove self-referential FKs
          .map((fk) => ({
            columnName: fk.COLUMN_NAME,
            referencedTableName: fk.REFERENCED_TABLE_NAME,
            referencedColumnName: fk.REFERENCED_COLUMN_NAME,
          })),
      };
    }

    return schema;
  }

  // Normalize default values
  private normalizeDefaultValue(defaultValue: any): string | undefined {
    if (defaultValue === null || defaultValue === undefined) {
      return undefined; // Use undefined (without quotes)
    }

    if (typeof defaultValue === 'string') {
      // Normalize function calls (e.g., `nextval`)
      if (defaultValue.startsWith('nextval')) {
        return 'AUTO_GENERATED';
      }
      if (defaultValue.startsWith('now')) {
        return 'AUTO_GENERATED';
      }
    }

    return String(defaultValue);
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
        createUserdbDto.ssl,
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
      this.logger.log(`Database ${newDatabase.id} created`);
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

  async findAll(
    userId: number,
    page: number,
    limit: number,
    search: string,
    sortBy: string = 'createdAt',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
  ) {
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
      const validSortBy = validSortFields.includes(sortBy)
        ? sortBy
        : 'createdAt';
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
        createUserdbDto.provider as
          | 'mysql'
          | 'mariadb'
          | 'postgres'
          | 'mssql'
          | 'oracle',
      );

      const tempDataSource = new DataSource({
        type: typeormProvider,
        host: createUserdbDto.host,
        port: createUserdbDto.port,
        username: createUserdbDto.username,
        password: createUserdbDto.password,
        database: createUserdbDto.name,
        ssl: getSSLConfig(createUserdbDto.ssl || SSLMode.DISABLE),
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
      const result = await this.userDbRepo.query(
        `
        SELECT
          COUNT(d.id) AS "totalCount",
          SUM(CASE WHEN EXISTS (
            SELECT 1 FROM queries q WHERE q."databaseId" = d.id
          ) THEN 1 ELSE 0 END) AS "activeCount"
        FROM databases d
        WHERE d."userId" = $1
      `,
        [userId],
      );

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
        inactiveCount: parsedTotalCount - parsedActiveCount,
      };
    } catch (error) {
      this.logger.error(
        `Failed to retrieve database count for user ${userId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve database count',
      );
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
        updateUserdbDto.ssl || SSLMode.DISABLE,
      );

      // Update the database entry with the new schema and other provided details
      const updatedDatabase = this.userDbRepo.merge(existingDatabase, {
        ...updateUserdbDto,
        schema: JSON.stringify(schema),
      });

      await this.userDbRepo.save(updatedDatabase);
      this.logger.log(`Database ${id} for user ${userId} updated`);
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
          'ssl',
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
      this.logger.log(`Database ${id} for user ${userId} deleted`);
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
