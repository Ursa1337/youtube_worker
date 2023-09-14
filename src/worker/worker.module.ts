import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { WorkerController } from './worker.controller'
import { WorkerService } from './worker.service'


@Module({
  controllers: [WorkerController],
  providers: [WorkerService],
  imports: [
    ConfigModule.forRoot(),
    ClientsModule.register([
      {
        name: 'RABBITMQ_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL],
          queue: 'YTVideoCallback',
          queueOptions: { durable: true }
        }
      }
    ])
  ]
})

export class WorkerModule {}