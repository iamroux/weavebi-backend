import { registerAs } from '@nestjs/config';

export default registerAs('mail', () => ({
  user: process.env.EMAIL_USER,
  pass: process.env.EMAIL_PASS,
}));
