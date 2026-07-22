import { Module } from '@nestjs/common';
import { BootstrapService } from './bootstrap.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({ providers: [BootstrapService, PrismaService] })
export class BootstrapModule {}
