import 'fastify';
import type { MikroORM } from '@mikro-orm/core';
import type { BootState } from '../modules/health/schemas.js';

declare module 'fastify' {
  interface FastifyInstance {
    getBootState(): BootState;
    setBootState(state: BootState): void;
    orm: MikroORM;
  }
}
