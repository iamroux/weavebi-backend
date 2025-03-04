import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CreateUserdbDto } from './dto/create-userdb.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { UserdbEntity } from './entities/userdb.entity';
import { DataSource, Repository } from 'typeorm';
import { UpdateUserdbDto } from './dto/update-userdb.dto';

interface ColumnInfo {
  name: string;
  type: string;
  isPrimary: boolean;
  isNullable?: boolean;
  isUnique?: boolean;
}

interface ForeignKeyInfo {
  columnName: string;
  referencedTableName: string;
  referencedColumnName: string;
}

interface TableInfo {
  columns: ColumnInfo[];
  foreignKeys?: ForeignKeyInfo[];
}

interface Schema {
  [tableName: string]: TableInfo;
}

interface SchemaMetadata {
  totalTables: number;
  totalColumns: number;
}

interface SchemaResult {
  metadata: SchemaMetadata;
  schema: Schema;
}

@Injectable()
export class UserdbService {
  private readonly logger = new Logger(UserdbService.name);

  constructor(
    @InjectRepository(UserdbEntity)
    private userDbRepo: Repository<UserdbEntity>,
  ) {}

  // Optimized schema extraction
  private async getSchema(
    provider: 'mysql' | 'mariadb' | 'postgres' | 'mssql' | 'oracle',
    host: string,
    port: number,
    username: string,
    password: string,
    database: string,
  ): Promise<SchemaResult> {
    try {
      const tempDataSource = new DataSource({
        type: provider,
        host,
        port,
        username,
        password,
        database,
      });

      await tempDataSource.initialize();
      const queryRunner = tempDataSource.createQueryRunner();
      const tables = await queryRunner.getTables();

      const schema: Schema = {};

      const systemSchemas = [
        'information_schema',
        'sys',
        'performance_schema',
        'mysql',
        'pg_catalog',
        'SYS',
        'SYSTEM',
        'CTXSYS',
      ];

      const systemTablePrefixes = ['pg_', '_pg_', 'sqlite_'];

      for (const table of tables) {
        // Exclude system tables and schemas
        if (
          systemSchemas.includes(table.schema ?? '') || // Fallback to empty string if undefined
          systemTablePrefixes.some((prefix) => table.name.startsWith(prefix))
        ) {
          continue;
        }

        // Simplify column information
        const columns: ColumnInfo[] = table.columns.map((col) => {
          const columnInfo: ColumnInfo = {
            name: col.name,
            type: col.type.split('(')[0], // Simplify type (e.g., "varchar(255)" → "varchar")
            isPrimary: col.isPrimary,
          };

          // Only include isNullable if it's false
          if (!col.isNullable) {
            columnInfo.isNullable = col.isNullable;
          }

          // Only include isUnique if it's true
          if (col.isUnique) {
            columnInfo.isUnique = col.isUnique;
          }

          return columnInfo;
        });

        // Simplify foreign key relationships
        const foreignKeys: ForeignKeyInfo[] = table.foreignKeys.map((fk) => ({
          columnName: fk.columnNames[0],
          referencedTableName: fk.referencedTableName,
          referencedColumnName: fk.referencedColumnNames[0],
        }));

        // Add table to schema
        schema[table.name] = {
          columns,
          ...(foreignKeys.length > 0 && { foreignKeys }),
        };
      }

      await queryRunner.release();
      await tempDataSource.destroy();

      // Add metadata for LLM context
      const schemaMetadata: SchemaMetadata = {
        totalTables: Object.keys(schema).length,
        totalColumns: Object.values(schema).reduce(
          (acc, table) => acc + table.columns.length,
          0,
        ),
      };

      return {
        metadata: schemaMetadata,
        schema,
      };
    } catch (error) {
      this.logger.error(`Failed to inspect schema: ${error.message}`);
      throw error;
    }
  }

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
        return 'Database already exists';
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
      );

      // Save to database using only existing fields in the entity
      const newDatabase = this.userDbRepo.create({
        ...createUserdbDto,
        userId: userId,
        schema: JSON.stringify(schema),
      });

      await this.userDbRepo.save(newDatabase);
      return 'Database added successfully';
    } catch (error) {
      this.logger.error(
        `Failed to save user ${userId}'s database to our database: ${error.message}`,
      );
      throw new InternalServerErrorException('Failed to connect to database');
    }
  }

  async findAll(userId: number, page: number, limit: number, search: string) {
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
    // create connection to run a simple select 1 query
    // if connection is ok return message "connection is ok"

    try {
      const tempDataSource = new DataSource({
        type: createUserdbDto.provider as
          | 'mysql'
          | 'mariadb'
          | 'postgres'
          | 'mssql'
          | 'oracle',
        host: createUserdbDto.host,
        port: createUserdbDto.port,
        username: createUserdbDto.username,
        password: createUserdbDto.password,
        database: createUserdbDto.name,
      });

      await tempDataSource.initialize();
      const queryRunner = tempDataSource.createQueryRunner();
      await queryRunner.query('SELECT 1');
      await queryRunner.release();
      await tempDataSource.destroy();

      return 'Connection is ok';
    } catch (error) {
      this.logger.error(`Failed to test connection: ${error.message}`);
      throw new InternalServerErrorException('Failed to test connection');
    }
  }

  async getCount(userId: number): Promise<{ count: number }> {
    try {
      const count = await this.userDbRepo.count({ where: { userId } });
      return { count };
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
        throw new Error('Database not found');
      }

      // Get the schema of the database
      const schema = await this.getSchema(
        updateUserdbDto.provider as 'mysql' | 'mariadb' | 'postgres' | 'mssql',
        updateUserdbDto.host || '',
        updateUserdbDto.port || 0,
        updateUserdbDto.username || '',
        updateUserdbDto.password || '',
        updateUserdbDto.name || '',
      );

      // Update the database entry with the new schema and other provided details
      const updatedDatabase = this.userDbRepo.merge(existingDatabase, {
        ...updateUserdbDto,
        schema: JSON.stringify(schema),
      });

      await this.userDbRepo.save(updatedDatabase);
      return 'Database updated successfully';
    } catch (error) {
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
          'description'
        ],
      });

      if (!database) {
        throw new Error('Database not found');
      }

      return database;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve user ${userId}'s database: ${error.message}`,
      );
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
        throw new Error('Database not found');
      }

      await this.userDbRepo.remove(database);
      return 'Database deleted successfully';
    } catch (error) {
      this.logger.error(
        `Failed to delete user ${userId}'s database: ${error.message}`,
      );
      throw new InternalServerErrorException('Failed to delete database');
    }
  }
}
