import { registerAs } from '@nestjs/config';

export default registerAs('encryption', () => ({
  password: process.env.ENCRYPTION_PASSWORD,
  salt: process.env.ENCRYPTION_SALT,
}));
