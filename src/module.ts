import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { WorkerModule } from './worker/worker.module'


@Module({
  imports: [
    ConfigModule.forRoot(),
    WorkerModule
  ]
})

export class AppModule {}