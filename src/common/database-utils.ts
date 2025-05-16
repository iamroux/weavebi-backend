import { BadRequestException } from '@nestjs/common';
import { SSLMode } from './global-enums';

// helper function to add ssl config
export function getSSLConfig(sslMode: SSLMode) {
  switch (sslMode) {
    case SSLMode.DISABLE:
      return false;
    case SSLMode.PREFER:
      return { rejectUnauthorized: false };
    case SSLMode.REQUIRE:
      return { rejectUnauthorized: true };
    default:
      return false;
  }
}
// helper function to map provider to typeORM
export function mapProviderToTypeORM(
  provider: 'mysql' | 'mariadb' | 'postgres' | 'mssql' | 'oracle',
): any {
  switch (provider) {
    case 'mysql':
      return 'mysql';
    case 'mariadb':
      return 'mariadb';
    case 'postgres':
      return 'postgres';
    case 'mssql':
      return 'mssql';
    case 'oracle':
      return 'oracle';
    default:
      throw new BadRequestException('Invalid database provider');
  }
}
