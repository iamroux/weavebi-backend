import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CreateUserdbDto } from './dto/create-userdb.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { UserdbEntity } from './entities/userdb.entity';
import {
  DataSource,
  DataSourceOptions,
  QueryRunner,
  Repository,
} from 'typeorm';
import { UpdateUserdbDto } from './dto/update-userdb.dto';
import { getSSLConfig, mapProviderToTypeORM } from 'src/common/database-utils';
import { SSLMode } from 'src/common/global-enums';

interface SchemaResult {
  database_name: string;
  database_type: string;
  tables: Array<{
    name: string;
    description?: string;
    columns: Array<{
      name: string;
      type: string;
      nullable?: boolean;
      primary_key?: boolean;
      auto_increment?: boolean;
      unique?: boolean;
      default?: string;
      description?: string;
      enum_values?: string[];
    }>;
    indexes?: Array<{
      name: string;
      columns: string[];
      unique?: boolean;
    }>;
  }>;
  relationships: Array<{
    name: string;
    type: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
    from_table: string;
    from_column: string;
    to_table: string;
    to_column: string;
    description?: string;
  }>;
  value_examples?: {
    [tableName: string]: Array<Record<string, any>>;
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
  // now i am become death

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
        const schemaData = await this.extractSchemaWithRawQueries(
          queryRunner,
          provider,
          database,
        );

        return schemaData;
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
    database: string,
  ): Promise<SchemaResult> {
    switch (provider) {
      case 'mysql':
      case 'mariadb':
        return this.extractMySQLSchema(queryRunner, database);
      case 'postgres':
        return this.extractPostgresSchema(queryRunner, database);
      case 'mssql':
        return this.extractMSSQLSchema(queryRunner, database);
      case 'oracle':
        return this.extractOracleSchema(queryRunner, database);
      default:
        throw new Error(`Unsupported database provider: ${provider}`);
    }
  }

  // Get relationship type based on foreign key constraints
  private getRelationshipType(
    fromTable: string,
    toTable: string,
    allForeignKeys: Record<
      string,
      Array<{ fromTable: string; toTable: string }>
    >,
  ): 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many' {
    const forwardRelations =
      allForeignKeys[fromTable]?.filter((fk) => fk.toTable === toTable) || [];
    const backwardRelations =
      allForeignKeys[toTable]?.filter((fk) => fk.toTable === fromTable) || [];

    if (forwardRelations.length > 0 && backwardRelations.length > 0) {
      return 'many_to_many';
    } else if (forwardRelations.length > 0) {
      return 'many_to_one';
    } else if (backwardRelations.length > 0) {
      return 'one_to_many';
    } else {
      return 'many_to_one';
    }
  }

  // Generate sample data for tables
  private async generateSampleData(
    queryRunner: QueryRunner,
    tableName: string,
    limit: number = 2,
  ): Promise<Array<Record<string, any>>> {
    try {
      const data = await queryRunner.query(`
      SELECT * FROM ${tableName} LIMIT ${limit}
      `);

      // Apply truncation to each value in the result
      return data.map((row: Record<string, any>) => {
        const truncatedRow: Record<string, any> = {};
        for (const key in row) {
          truncatedRow[key] = this.truncateLongValues(row[key]);
        }
        return truncatedRow;
      });
    } catch (error) {
      this.logger.warn(
        `Failed to get sample data for table ${tableName}: ${error.message}`,
      );
      return [];
    }
  }

  //helper function to truncate long values for sample data
  private truncateLongValues(value: any): any {
    if (typeof value === 'string' && value.length > 200) {
      return value.substring(0, 200) + '...';
    }
    return value;
  }

  // MySQL/MariaDB schema extraction
  private async extractMySQLSchema(
    queryRunner: QueryRunner,
    database: string,
  ): Promise<SchemaResult> {
    const tables: Array<{
      name: string;
      description?: string;
      columns: any[];
      indexes?: any[];
    }> = [];
    const relationships: SchemaResult['relationships'] = [];
    const valueExamples: SchemaResult['value_examples'] = {};

    // Get tables
    const tableResults = await queryRunner.query(`
    SELECT table_name, table_comment
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
  `);

    // Track all foreign keys for relationship detection
    const allForeignKeys: Record<
      string,
      Array<{ fromTable: string; toTable: string }>
    > = {};

    for (const table of tableResults) {
      const tableName = table.TABLE_NAME;
      const tableDescription = table.TABLE_COMMENT || undefined;

      // Get columns
      const columns = await queryRunner.query(
        `
      SELECT 
        column_name, data_type, is_nullable, column_key, column_default, 
        column_comment, extra, character_maximum_length, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
    `,
        [tableName],
      );

      // Get indexes
      const indexes = await queryRunner.query(
        `
      SELECT 
        index_name, column_name, non_unique
      FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY index_name, seq_in_index
    `,
        [tableName],
      );

      // Process indexes
      const processedIndexes: { [key: string]: any } = {};
      indexes.forEach((idx: any) => {
        if (!processedIndexes[idx.INDEX_NAME]) {
          processedIndexes[idx.INDEX_NAME] = {
            name: idx.INDEX_NAME,
            columns: [],
          };

          if (idx.NON_UNIQUE === 0) {
            processedIndexes[idx.INDEX_NAME].unique = true;
          }
        }
        processedIndexes[idx.INDEX_NAME].columns.push(idx.COLUMN_NAME);
      });

      // Get foreign keys
      const foreignKeys = await queryRunner.query(
        `
      SELECT 
        k.column_name, k.referenced_table_name, k.referenced_column_name,
        tc.constraint_name
      FROM information_schema.key_column_usage k
      JOIN information_schema.table_constraints tc 
        ON k.constraint_name = tc.constraint_name
      WHERE k.table_schema = DATABASE() 
        AND k.table_name = ?
        AND k.referenced_table_name IS NOT NULL
        AND tc.constraint_type = 'FOREIGN KEY'
    `,
        [tableName],
      );

      // Prepare table schema
      const tableSchema: any = {
        name: tableName,
        ...(tableDescription && { description: tableDescription }),
        columns: columns.map((col: any) => {
          const colSchema: any = {
            name: col.COLUMN_NAME,
            type:
              col.DATA_TYPE +
              (col.CHARACTER_MAXIMUM_LENGTH
                ? `(${col.CHARACTER_MAXIMUM_LENGTH})`
                : ''),
            ...(col.COLUMN_COMMENT && { description: col.COLUMN_COMMENT }),
          };

          // Only add properties that are true or have values
          if (col.IS_NULLABLE === 'NO') {
            colSchema.nullable = false;
          }

          if (col.COLUMN_KEY === 'PRI') {
            colSchema.primary_key = true;
          }

          if (col.COLUMN_KEY === 'UNI') {
            colSchema.unique = true;
          }

          if (col.EXTRA?.includes('auto_increment')) {
            colSchema.auto_increment = true;
          }

          if (col.COLUMN_DEFAULT !== null) {
            colSchema.default = this.normalizeDefaultValue(col.COLUMN_DEFAULT);
          }

          return colSchema;
        }),
      };

      // Only add indexes if there are any (excluding primary keys which are already in columns)
      const tableIndexes = Object.values(processedIndexes).filter(
        (idx: any) => idx.name !== 'PRIMARY',
      );

      if (tableIndexes.length > 0) {
        tableSchema.indexes = tableIndexes;
      }

      tables.push(tableSchema);

      // Add foreign keys to relationship tracking
      if (foreignKeys.length > 0) {
        if (!allForeignKeys[tableName]) {
          allForeignKeys[tableName] = [];
        }

        foreignKeys.forEach((fk: any) => {
          allForeignKeys[tableName].push({
            fromTable: tableName,
            toTable: fk.REFERENCED_TABLE_NAME,
          });
        });
      }

      // Generate sample data for this table
      try {
        const samples = await this.generateSampleData(queryRunner, tableName);
        if (samples.length > 0) {
          valueExamples[tableName] = samples;
        }
      } catch (error) {
        // If sample data can't be fetched, continue without it
      }
    }

    // Process relationships
    for (const tableName in allForeignKeys) {
      const tableFks = allForeignKeys[tableName];

      for (const fk of tableFks) {
        const foreignKey = await queryRunner.query(
          `
        SELECT 
          k.column_name, k.referenced_table_name, k.referenced_column_name,
          tc.constraint_name
        FROM information_schema.key_column_usage k
        JOIN information_schema.table_constraints tc 
          ON k.constraint_name = tc.constraint_name
        WHERE k.table_schema = DATABASE() 
          AND k.table_name = ?
          AND k.referenced_table_name = ?
      `,
          [tableName, fk.toTable],
        );

        if (foreignKey.length > 0) {
          relationships.push({
            name: `${tableName}_to_${fk.toTable}`,
            type: this.getRelationshipType(
              tableName,
              fk.toTable,
              allForeignKeys,
            ),
            from_table: tableName,
            from_column: foreignKey[0].COLUMN_NAME,
            to_table: fk.toTable,
            to_column: foreignKey[0].REFERENCED_COLUMN_NAME,
            ...(foreignKey[0].CONSTRAINT_NAME && {
              description: `Relationship from ${tableName} to ${fk.toTable}`,
            }),
          });
        }
      }
    }

    const result: SchemaResult = {
      database_name: database,
      database_type: 'MySQL',
      tables,
      relationships,
    };

    // Only add value_examples if we have sample data
    if (Object.keys(valueExamples).length > 0) {
      result.value_examples = valueExamples;
    }

    return result;
  }

  // Postgres schema extraction
  private async extractPostgresSchema(
    queryRunner: QueryRunner,
    database: string,
  ): Promise<SchemaResult> {
    const tables: Array<{
      name: string;
      description?: string;
      columns: any[];
      indexes?: any[];
    }> = [];
    const relationships: SchemaResult['relationships'] = [];
    const valueExamples: SchemaResult['value_examples'] = {};

    // Get tables with comments
    const tableResults = await queryRunner.query(`
    SELECT t.table_name,
           pg_catalog.obj_description(pgc.oid, 'pg_class') as table_comment
    FROM information_schema.tables t
    JOIN pg_catalog.pg_class pgc ON t.table_name = pgc.relname
    WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
  `);

    // Track all foreign keys for relationship detection
    const allForeignKeys: Record<
      string,
      Array<{ fromTable: string; toTable: string }>
    > = {};

    for (const table of tableResults) {
      const tableName = table.table_name;
      const tableDescription = table.table_comment || undefined;

      // Get columns with comments
      const columns = await queryRunner.query(
        `
      SELECT 
        c.column_name, c.data_type, c.is_nullable, c.column_default, c.udt_name,
        pg_catalog.col_description(pgc.oid, c.ordinal_position) as column_comment,
        c.character_maximum_length, c.numeric_precision, c.numeric_scale
      FROM information_schema.columns c
      JOIN pg_catalog.pg_class pgc ON c.table_name = pgc.relname
      WHERE c.table_schema = 'public' AND c.table_name = $1
      ORDER BY c.ordinal_position
    `,
        [tableName],
      );

      // Get primary key info
      const primaryKeys = await queryRunner.query(
        `
      SELECT a.attname as column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass
      AND i.indisprimary
    `,
        [tableName],
      );

      // Get identity columns (auto-increment equivalent)
      const identityColumns = await queryRunner.query(
        `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' 
      AND table_name = $1
      AND is_identity = 'YES'
    `,
        [tableName],
      );

      // Get unique constraints
      const uniqueConstraints = await queryRunner.query(
        `
      SELECT DISTINCT c.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage c ON tc.constraint_name = c.constraint_name
      WHERE tc.table_schema = 'public' 
      AND tc.table_name = $1
      AND tc.constraint_type = 'UNIQUE'
    `,
        [tableName],
      );

      // Get enum values for enum types
      const enumColumns = columns.filter(
        (col: any) =>
          col.udt_name.startsWith('_') || col.data_type === 'USER-DEFINED',
      );
      const enumValuesMap = new Map<string, string[]>();
      for (const col of enumColumns) {
        try {
          const enumType = col.udt_name.startsWith('_')
            ? col.udt_name.substring(1)
            : col.udt_name;
          const enumValues = await queryRunner.query(
            `
          SELECT e.enumlabel as value
          FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
          JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = $1
        `,
            [enumType],
          );

          if (enumValues.length > 0) {
            enumValuesMap.set(
              col.column_name,
              enumValues.map((v: any) => v.value),
            );
          }
        } catch (error) {
          // Skip if enum retrieval fails
        }
      }

      // Get indexes (excluding primary keys)
      const indexes = await queryRunner.query(
        `
      SELECT
        i.relname as index_name,
        array_agg(a.attname) as column_names,
        ix.indisunique as is_unique
      FROM
        pg_class i
        JOIN pg_index ix ON i.oid = ix.indexrelid
        JOIN pg_class t ON ix.indrelid = t.oid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE
        t.relname = $1
        AND i.relkind = 'i'
        AND ix.indisprimary = false
      GROUP BY
        i.relname, ix.indisunique
    `,
        [tableName],
      );

      // Get foreign keys
      const foreignKeys = await queryRunner.query(
        `
      SELECT
        kcu.column_name,
        ccu.table_name AS referenced_table_name,
        ccu.column_name AS referenced_column_name,
        tc.constraint_name
      FROM
        information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
      WHERE
        tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = $1
    `,
        [tableName],
      );

      // Map primary key columns
      const primaryKeyColumns = new Set(
        primaryKeys.map((pk: any) => pk.column_name),
      );

      // Map identity columns (auto increment)
      const autoIncrementColumns = new Set(
        identityColumns.map((ic: any) => ic.column_name),
      );

      // Map unique constraint columns
      const uniqueColumns = new Set(
        uniqueConstraints.map((uc: any) => uc.column_name),
      );

      // Prepare table schema
      const tableSchema: any = {
        name: tableName,
        ...(tableDescription && { description: tableDescription }),
        columns: columns.map((col: any) => {
          const colSchema: any = {
            name: col.column_name,
            type: this.formatPostgresType(col),
            ...(col.column_comment && { description: col.column_comment }),
          };

          // Only add properties that are true or have values
          if (col.is_nullable === 'NO') {
            colSchema.nullable = false;
          }

          if (primaryKeyColumns.has(col.column_name)) {
            colSchema.primary_key = true;
          }

          if (uniqueColumns.has(col.column_name)) {
            colSchema.unique = true;
          }

          if (autoIncrementColumns.has(col.column_name)) {
            colSchema.auto_increment = true;
          }

          if (col.column_default !== null) {
            colSchema.default = this.normalizeDefaultValue(col.column_default);
          }

          // Add enum values if applicable
          if (enumValuesMap.has(col.column_name)) {
            colSchema.enum_values = enumValuesMap.get(col.column_name);
          }

          return colSchema;
        }),
      };

      // Add indexes if there are any
      if (indexes.length > 0) {
        tableSchema.indexes = indexes.map((idx: any) => {
          const indexSchema: any = {
            name: idx.index_name,
            columns: idx.column_names,
          };

          if (idx.is_unique) {
            indexSchema.unique = true;
          }

          return indexSchema;
        });
      }

      tables.push(tableSchema);

      // Add foreign keys to relationship tracking
      if (foreignKeys.length > 0) {
        if (!allForeignKeys[tableName]) {
          allForeignKeys[tableName] = [];
        }

        foreignKeys.forEach((fk: any) => {
          allForeignKeys[tableName].push({
            fromTable: tableName,
            toTable: fk.referenced_table_name,
          });
        });
      }

      // Generate sample data for this table
      try {
        const samples = await this.generateSampleData(queryRunner, tableName);
        if (samples.length > 0) {
          valueExamples[tableName] = samples;
        }
      } catch (error) {
        // If sample data can't be fetched, continue without it
      }
    }

    // Process relationships
    for (const tableName in allForeignKeys) {
      const tableFks = allForeignKeys[tableName];

      for (const fk of tableFks) {
        const foreignKey = await queryRunner.query(
          `
        SELECT
          kcu.column_name,
          ccu.table_name AS referenced_table_name,
          ccu.column_name AS referenced_column_name,
          tc.constraint_name
        FROM
          information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
        WHERE
          tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = $1
          AND ccu.table_name = $2
      `,
          [tableName, fk.toTable],
        );

        if (foreignKey.length > 0) {
          relationships.push({
            name: `${tableName}_to_${fk.toTable}`,
            type: this.getRelationshipType(
              tableName,
              fk.toTable,
              allForeignKeys,
            ),
            from_table: tableName,
            from_column: foreignKey[0].column_name,
            to_table: fk.toTable,
            to_column: foreignKey[0].referenced_column_name,
            ...(foreignKey[0].constraint_name && {
              description: `Relationship from ${tableName} to ${fk.toTable}`,
            }),
          });
        }
      }
    }

    const result: SchemaResult = {
      database_name: database,
      database_type: 'PostgreSQL',
      tables,
      relationships,
    };

    // Only add value_examples if we have sample data
    if (Object.keys(valueExamples).length > 0) {
      result.value_examples = valueExamples;
    }

    return result;
  }

  // Format PostgreSQL data type with precision/scale if applicable
  private formatPostgresType(column: any): string {
    const baseType = column.data_type;

    if (column.character_maximum_length) {
      return `${baseType}(${column.character_maximum_length})`;
    }

    if (column.numeric_precision && column.numeric_scale) {
      return `${baseType}(${column.numeric_precision},${column.numeric_scale})`;
    }

    return baseType;
  }

  // MSSQL schema extraction
  private async extractMSSQLSchema(
    queryRunner: QueryRunner,
    database: string,
  ): Promise<SchemaResult> {
    const tables: Array<{
      name: string;
      description?: string;
      columns: any[];
      indexes?: any[];
    }> = [];
    const relationships: SchemaResult['relationships'] = [];
    const valueExamples: SchemaResult['value_examples'] = {};

    // Get tables with extended properties for descriptions
    const tableResults = await queryRunner.query(`
    SELECT 
      t.name AS table_name,
      ISNULL(ep.value, '') AS table_description
    FROM 
      sys.tables t
      LEFT JOIN sys.extended_properties ep ON 
        ep.major_id = t.object_id AND
        ep.minor_id = 0 AND
        ep.name = 'MS_Description'
    ORDER BY t.name
  `);

    // Track all foreign keys for relationship detection
    const allForeignKeys: Record<
      string,
      Array<{ fromTable: string; toTable: string }>
    > = {};

    for (const table of tableResults) {
      const tableName = table.table_name;
      const tableDescription = table.table_description || undefined;

      // Get columns with extended properties for descriptions
      const columns = await queryRunner.query(
        `
      SELECT 
        c.name AS column_name,
        t.name AS data_type,
        c.is_nullable,
        c.is_identity,
        OBJECT_DEFINITION(c.default_object_id) AS column_default,
        ISNULL(ep.value, '') AS column_description,
        c.max_length,
        c.precision,
        c.scale
      FROM 
        sys.columns c
        JOIN sys.types t ON c.user_type_id = t.user_type_id
        LEFT JOIN sys.extended_properties ep ON 
          ep.major_id = c.object_id AND
          ep.minor_id = c.column_id AND
          ep.name = 'MS_Description'
      WHERE 
        c.object_id = OBJECT_ID(?)
      ORDER BY c.column_id
    `,
        [tableName],
      );

      // Get primary key info
      const primaryKeys = await queryRunner.query(
        `
      SELECT 
        c.name AS column_name
      FROM 
        sys.index_columns ic
        JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
        JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE 
        i.is_primary_key = 1 AND
        i.object_id = OBJECT_ID(?)
    `,
        [tableName],
      );

      // Get unique constraints
      const uniqueConstraints = await queryRunner.query(
        `
      SELECT 
        c.name AS column_name
      FROM 
        sys.index_columns ic
        JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
        JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE 
        i.is_unique = 1 AND
        i.is_primary_key = 0 AND
        i.object_id = OBJECT_ID(?)
    `,
        [tableName],
      );

      // Get indexes
      const indexes = await queryRunner.query(
        `
      SELECT 
        i.name AS index_name,
        i.is_unique,
        STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS column_names
      FROM 
        sys.indexes i
        JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE 
        i.object_id = OBJECT_ID(?) AND
        i.is_primary_key = 0
      GROUP BY
        i.name, i.is_unique
    `,
        [tableName],
      );

      // Get foreign keys
      const foreignKeys = await queryRunner.query(
        `
      SELECT 
        COL_NAME(fk.parent_object_id, fkc.parent_column_id) AS column_name,
        OBJECT_NAME(fk.referenced_object_id) AS referenced_table_name,
        COL_NAME(fk.referenced_object_id, fkc.referenced_column_id) AS referenced_column_name
      FROM 
        sys.foreign_keys fk
        JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
      WHERE 
        fk.parent_object_id = OBJECT_ID(?)
    `,
        [tableName],
      );

      // Map primary key columns
      const primaryKeyColumns = new Set(
        primaryKeys.map((pk: any) => pk.column_name),
      );

      // Map unique constraint columns
      const uniqueColumns = new Set(
        uniqueConstraints.map((uc: any) => uc.column_name),
      );

      // Prepare table schema
      const tableSchema: any = {
        name: tableName,
        ...(tableDescription && { description: tableDescription }),
        columns: columns.map((col: any) => {
          const colSchema: any = {
            name: col.column_name,
            type: this.formatMSSQLType(col),
            ...(col.column_description && {
              description: col.column_description,
            }),
          };

          // Only add properties that are true or have values
          if (col.is_nullable === 0) {
            colSchema.nullable = false;
          }

          if (primaryKeyColumns.has(col.column_name)) {
            colSchema.primary_key = true;
          }

          if (uniqueColumns.has(col.column_name)) {
            colSchema.unique = true;
          }

          if (col.is_identity === 1) {
            colSchema.auto_increment = true;
          }

          if (col.column_default !== null) {
            colSchema.default = this.normalizeDefaultValue(col.column_default);
          }

          return colSchema;
        }),
      };

      // Add indexes if there are any
      if (indexes.length > 0) {
        tableSchema.indexes = indexes.map((idx: any) => {
          const indexSchema: any = {
            name: idx.index_name,
            columns: idx.column_names.split(','),
          };

          if (idx.is_unique === 1) {
            indexSchema.unique = true;
          }

          return indexSchema;
        });
      }

      tables.push(tableSchema);

      // Add foreign keys to relationship tracking
      if (foreignKeys.length > 0) {
        if (!allForeignKeys[tableName]) {
          allForeignKeys[tableName] = [];
        }

        foreignKeys.forEach((fk: any) => {
          allForeignKeys[tableName].push({
            fromTable: tableName,
            toTable: fk.referenced_table_name,
          });
        });
      }

      // Generate sample data for this table
      try {
        const samples = await this.generateSampleData(queryRunner, tableName);
        if (samples.length > 0) {
          valueExamples[tableName] = samples;
        }
      } catch (error) {
        // If sample data can't be fetched, continue without it
      }
    }

    // Process relationships
    for (const tableName in allForeignKeys) {
      const tableFks = allForeignKeys[tableName];

      for (const fk of tableFks) {
        const foreignKey = await queryRunner.query(
          `
        SELECT 
          COL_NAME(fk.parent_object_id, fkc.parent_column_id) AS column_name,
          OBJECT_NAME(fk.referenced_object_id) AS referenced_table_name,
          COL_NAME(fk.referenced_object_id, fkc.referenced_column_id) AS referenced_column_name
        FROM 
          sys.foreign_keys fk
          JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        WHERE 
          fk.parent_object_id = OBJECT_ID(?) AND
          OBJECT_NAME(fk.referenced_object_id) = ?
      `,
          [tableName, fk.toTable],
        );

        if (foreignKey.length > 0) {
          relationships.push({
            name: `${tableName}_to_${fk.toTable}`,
            type: this.getRelationshipType(
              tableName,
              fk.toTable,
              allForeignKeys,
            ),
            from_table: tableName,
            from_column: foreignKey[0].column_name,
            to_table: fk.toTable,
            to_column: foreignKey[0].referenced_column_name,
            ...(foreignKey[0].constraint_name && {
              description: `Relationship from ${tableName} to ${fk.toTable}`,
            }),
          });
        }
      }
    }

    const result: SchemaResult = {
      database_name: database,
      database_type: 'SQL Server',
      tables,
      relationships,
    };

    // Only add value_examples if we have sample data
    if (Object.keys(valueExamples).length > 0) {
      result.value_examples = valueExamples;
    }

    return result;
  }

  // Format MSSQL data type with precision/scale if applicable
  private formatMSSQLType(column: any): string {
    const baseType = column.data_type;

    if (['varchar', 'nvarchar', 'char', 'nchar'].includes(baseType)) {
      const length = column.max_length === -1 ? 'MAX' : column.max_length;
      return `${baseType}(${length})`;
    }

    if (['decimal', 'numeric'].includes(baseType)) {
      return `${baseType}(${column.precision},${column.scale})`;
    }

    return baseType;
  }

  // Oracle schema extraction
  private async extractOracleSchema(
    queryRunner: QueryRunner,
    database: string,
  ): Promise<SchemaResult> {
    const tables: Array<{
      name: string;
      description?: string;
      columns: any[];
      indexes?: any[];
    }> = [];
    const relationships: SchemaResult['relationships'] = [];
    const valueExamples: SchemaResult['value_examples'] = {};

    // Get tables with comments
    const tableResults = await queryRunner.query(
      `
    SELECT 
      table_name,
      comments as table_comment
    FROM 
      all_tab_comments
    WHERE 
      owner = UPPER(:1)
  `,
      [database],
    );

    // Track all foreign keys for relationship detection
    const allForeignKeys: Record<
      string,
      Array<{ fromTable: string; toTable: string }>
    > = {};

    for (const table of tableResults) {
      const tableName = table.TABLE_NAME;
      const tableDescription = table.TABLE_COMMENT || undefined;

      // Get columns with comments
      const columns = await queryRunner.query(
        `
      SELECT 
        c.column_name,
        c.data_type,
        c.nullable,
        c.data_default as column_default,
        cc.comments as column_comment,
        c.char_length,
        c.data_precision,
        c.data_scale
      FROM 
        all_tab_columns c
        LEFT JOIN all_col_comments cc ON 
          c.owner = cc.owner AND
          c.table_name = cc.table_name AND
          c.column_name = cc.column_name
      WHERE 
        c.owner = UPPER(:1) AND
        c.table_name = :2
      ORDER BY c.column_id
    `,
        [database, tableName],
      );

      // Get primary key info
      const primaryKeys = await queryRunner.query(
        `
      SELECT 
        cols.column_name
      FROM 
        all_constraints cons
        JOIN all_cons_columns cols ON 
          cons.constraint_name = cols.constraint_name AND
          cons.owner = cols.owner
      WHERE 
        cons.constraint_type = 'P' AND
        cons.owner = UPPER(:1) AND
        cons.table_name = :2
    `,
        [database, tableName],
      );

      // Get unique constraints
      const uniqueConstraints = await queryRunner.query(
        `
      SELECT 
        cols.column_name
      FROM 
        all_constraints cons
        JOIN all_cons_columns cols ON 
          cons.constraint_name = cols.constraint_name AND
          cons.owner = cols.owner
      WHERE 
        cons.constraint_type = 'U' AND
        cons.owner = UPPER(:1) AND
        cons.table_name = :2
    `,
        [database, tableName],
      );

      // Get identity columns (Oracle 12c+ only)
      const identityColumns = await queryRunner
        .query(
          `
      SELECT 
        column_name
      FROM 
        all_tab_columns
      WHERE 
        owner = UPPER(:1) AND
        table_name = :2 AND
        identity_column = 'YES'
    `,
          [database, tableName],
        )
        .catch(() => []); // Catch and return empty array if not supported

      // Get indexes
      const indexes = await queryRunner.query(
        `
      SELECT 
        i.index_name,
        i.uniqueness,
        LISTAGG(ic.column_name, ',') WITHIN GROUP (ORDER BY ic.column_position) as column_names
      FROM 
        all_indexes i
        JOIN all_ind_columns ic ON 
          i.index_name = ic.index_name AND
          i.owner = ic.index_owner
      WHERE 
        i.owner = UPPER(:1) AND
        i.table_name = :2 AND
        i.index_type != 'LOB'
      GROUP BY
        i.index_name, i.uniqueness
    `,
        [database, tableName],
      );

      // Get foreign keys
      const foreignKeys = await queryRunner.query(
        `
      SELECT 
        a.column_name,
        c_pk.table_name as referenced_table_name,
        r_cols.column_name as referenced_column_name
      FROM 
        all_constraints c
        JOIN all_cons_columns a ON 
          a.constraint_name = c.constraint_name AND
          a.owner = c.owner
        JOIN all_constraints c_pk ON 
          c.r_constraint_name = c_pk.constraint_name AND
          c.r_owner = c_pk.owner
        JOIN all_cons_columns r_cols ON 
          r_cols.constraint_name = c_pk.constraint_name AND
          r_cols.owner = c_pk.owner AND
          r_cols.position = a.position
      WHERE 
        c.constraint_type = 'R' AND
        c.owner = UPPER(:1) AND
        c.table_name = :2
    `,
        [database, tableName],
      );

      // Map primary key columns
      const primaryKeyColumns = new Set(
        primaryKeys.map((pk: any) => pk.COLUMN_NAME),
      );

      // Map unique constraint columns
      const uniqueColumns = new Set(
        uniqueConstraints.map((uc: any) => uc.COLUMN_NAME),
      );

      // Map identity columns
      const autoIncrementColumns = new Set(
        identityColumns.map((ic: any) => ic.COLUMN_NAME),
      );

      // Prepare table schema
      const tableSchema: any = {
        name: tableName,
        ...(tableDescription && { description: tableDescription }),
        columns: columns.map((col: any) => {
          const colSchema: any = {
            name: col.COLUMN_NAME,
            type: this.formatOracleType(col),
            ...(col.COLUMN_COMMENT && { description: col.COLUMN_COMMENT }),
          };

          // Only add properties that are true or have values
          if (col.NULLABLE === 'N') {
            colSchema.nullable = false;
          }

          if (primaryKeyColumns.has(col.COLUMN_NAME)) {
            colSchema.primary_key = true;
          }

          if (uniqueColumns.has(col.COLUMN_NAME)) {
            colSchema.unique = true;
          }

          if (autoIncrementColumns.has(col.COLUMN_NAME)) {
            colSchema.auto_increment = true;
          }

          if (col.COLUMN_DEFAULT !== null) {
            colSchema.default = this.normalizeDefaultValue(col.COLUMN_DEFAULT);
          }

          return colSchema;
        }),
      };

      // Add indexes if there are any
      if (indexes.length > 0) {
        tableSchema.indexes = indexes.map((idx: any) => {
          const indexSchema: any = {
            name: idx.INDEX_NAME,
            columns: idx.COLUMN_NAMES.split(','),
          };

          if (idx.UNIQUENESS === 'UNIQUE') {
            indexSchema.unique = true;
          }

          return indexSchema;
        });
      }

      tables.push(tableSchema);

      // Add foreign keys to relationship tracking
      if (foreignKeys.length > 0) {
        if (!allForeignKeys[tableName]) {
          allForeignKeys[tableName] = [];
        }

        foreignKeys.forEach((fk: any) => {
          allForeignKeys[tableName].push({
            fromTable: tableName,
            toTable: fk.REFERENCED_TABLE_NAME,
          });
        });
      }

      // Generate sample data for this table
      try {
        const samples = await this.generateSampleData(queryRunner, tableName);
        if (samples.length > 0) {
          valueExamples[tableName] = samples;
        }
      } catch (error) {
        // If sample data can't be fetched, continue without it
      }
    }

    // Process relationships
    for (const tableName in allForeignKeys) {
      const tableFks = allForeignKeys[tableName];

      for (const fk of tableFks) {
        const foreignKey = await queryRunner.query(
          `
        SELECT 
          a.column_name,
          c_pk.table_name as referenced_table_name,
          r_cols.column_name as referenced_column_name
        FROM 
          all_constraints c
          JOIN all_cons_columns a ON 
            a.constraint_name = c.constraint_name AND
            a.owner = c.owner
          JOIN all_constraints c_pk ON 
            c.r_constraint_name = c_pk.constraint_name AND
            c.r_owner = c_pk.owner
          JOIN all_cons_columns r_cols ON 
            r_cols.constraint_name = c_pk.constraint_name AND
            r_cols.owner = c_pk.owner AND
            r_cols.position = a.position
        WHERE 
          c.constraint_type = 'R' AND
          c.owner = UPPER(:1) AND
          c.table_name = :2 AND
          c_pk.table_name = :3
      `,
          [database, tableName, fk.toTable],
        );

        if (foreignKey.length > 0) {
          relationships.push({
            name: `${tableName}_to_${fk.toTable}`,
            type: this.getRelationshipType(
              tableName,
              fk.toTable,
              allForeignKeys,
            ),
            from_table: tableName,
            from_column: foreignKey[0].COLUMN_NAME,
            to_table: fk.toTable,
            to_column: foreignKey[0].REFERENCED_COLUMN_NAME,
            ...(foreignKey[0].constraint_name && {
              description: `Relationship from ${tableName} to ${fk.toTable}`,
            }),
          });
        }
      }
    }

    const result: SchemaResult = {
      database_name: database,
      database_type: 'Oracle',
      tables,
      relationships,
    };

    // Only add value_examples if we have sample data
    if (Object.keys(valueExamples).length > 0) {
      result.value_examples = valueExamples;
    }

    return result;
  }

  // Format Oracle data type with precision/scale if applicable
  private formatOracleType(column: any): string {
    const baseType = column.DATA_TYPE;

    if (['VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR'].includes(baseType)) {
      return `${baseType}(${column.CHAR_LENGTH})`;
    }

    if (['NUMBER'].includes(baseType) && column.DATA_PRECISION !== null) {
      return column.DATA_SCALE !== null
        ? `${baseType}(${column.DATA_PRECISION},${column.DATA_SCALE})`
        : `${baseType}(${column.DATA_PRECISION})`;
    }

    return baseType;
  }

  // Normalize default value for better readability
  private normalizeDefaultValue(defaultValue: string): string {
    if (!defaultValue) return '';

    // Remove typical database wrappers
    let normalized = defaultValue.trim();

    // MySQL/PostgreSQL: Remove surrounding quotes
    normalized = normalized.replace(/^'(.*)'$/, '$1');

    // PostgreSQL: Remove surrounding parentheses for functions
    normalized = normalized.replace(/^\((.*)\)$/, '$1');

    // SQL Server: Remove surrounding parentheses
    normalized = normalized.replace(/^\((.*)\)$/, '$1');

    // Oracle: Remove surrounding quotes
    normalized = normalized.replace(/^"(.*)"$/, '$1');

    // Replace double quotes with single quotes for consistency
    normalized = normalized.replace(/"/g, "'");

    // Handle common database-specific default value patterns
    if (normalized.match(/^nextval\(.*\)$/i)) {
      return 'AUTO_INCREMENT';
    }

    if (normalized.match(/^current_timestamp/i)) {
      return 'CURRENT_TIMESTAMP';
    }

    if (normalized.match(/^getdate\(\)/i)) {
      return 'CURRENT_TIMESTAMP';
    }

    if (normalized.match(/^sysdate/i)) {
      return 'CURRENT_TIMESTAMP';
    }

    return normalized;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  // Create a new database connection
  async create(userId: number, createUserdbDto: CreateUserdbDto) {
    try {
      const existingDatabase = await this.userDbRepo.findOne({
        where: {
          userId: userId,
          name: createUserdbDto.name,
        },
      });

      if (existingDatabase) {
        throw new ConflictException('Database with same name already exists');
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
  }

  async update(userId: number, id: number, updateUserdbDto: UpdateUserdbDto) {
    const existingDatabase = await this.userDbRepo.findOne({
      where: {
        id: id,
        userId: userId,
      },
    });

    if (!existingDatabase) {
      throw new BadRequestException('Database not found');
    }

    // Check if the database name is being changed to an existing one
    if (
      updateUserdbDto.name &&
      updateUserdbDto.name !== existingDatabase.name
    ) {
      const existingName = await this.userDbRepo.findOne({
        where: {
          name: updateUserdbDto.name,
          userId: userId,
        },
      });

      if (existingName) {
        throw new ConflictException('Database with same name already exists');
      }
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
  }

  async findOne(userId: number, id: number) {
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
  }

  async remove(userId: number, id: number) {
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
  }
}
