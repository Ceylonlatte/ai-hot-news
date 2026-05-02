import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LivenessService } from './liveness.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [LivenessService],
})
export class WorkerModule {}
