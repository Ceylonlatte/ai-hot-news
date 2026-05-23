import { Module } from '@nestjs/common';
import { KeywordsController } from './keywords.controller';
import { KeywordsService } from './keywords.service';

// SP-14 (2026-05-23): keyword CRUD module.
// JwtAuthGuard is provided globally by AuthModule (SP-13 @Global), so
// importing AuthModule here is not needed — the @UseGuards decorator
// on the controller resolves it from the global container.
@Module({
  controllers: [KeywordsController],
  providers: [KeywordsService],
  exports: [KeywordsService],
})
export class KeywordsModule {}
