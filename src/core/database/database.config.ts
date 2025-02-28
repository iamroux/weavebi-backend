import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';

config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST,
  port: process.env.DATABASE_PORT,
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
  synchronize: true,
  dropSchema: false,
  //logging: true,
  // ssl: {
  //   rejectUnauthorized: false,
  // }
} as DataSourceOptions);
