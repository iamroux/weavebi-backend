import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: process.env.APP_PORT,
  title: process.env.APP_TITLE,
  description: process.env.APP_DESCRIPTION,
  version: process.env.APP_VERSION,
}));
