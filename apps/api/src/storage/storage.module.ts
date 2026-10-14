import { Global, Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({ providers: [StorageService, CleanupService], exports: [StorageService] })
export class StorageModule {}
