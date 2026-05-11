import * as dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

const env = process.env.NODE_ENV ?? 'local';
dotenv.config({ path: `.env.${env}` });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
