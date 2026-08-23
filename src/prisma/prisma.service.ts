import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantGuardExtension } from '../common/prisma-tenant-guard.extension';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
    // #152's Prisma Client Extension backstop, wired in after $connect()
    // so the underlying engine is already live. $extends() returns a new
    // client-like object rather than mutating `this`, so its own
    // properties (model delegates, $transaction, etc. — all of which are
    // own instance properties on a Prisma Client, not prototype methods)
    // are copied onto `this`. This keeps `this` as the exact same
    // PrismaService instance everywhere it's already injected (no
    // constructor changes, no injection-site changes needed across the
    // app), while every model delegate call — including inside
    // $transaction() callbacks, since $transaction itself is copied over
    // too — now runs through the tenant guard.
    Object.assign(this, this.$extends(tenantGuardExtension));
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
