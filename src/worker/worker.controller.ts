import { Controller } from '@nestjs/common'
import { MessagePattern, Payload } from '@nestjs/microservices'
import { WorkerService } from './worker.service'
import { VideoRetrivingDTO } from './worker.dto'


@Controller('worker')
export class WorkerController {
  constructor(private workerService: WorkerService) {}

  @MessagePattern({ cmd: 'retrievingVideo' })
  retrievingVideo(@Payload() data: VideoRetrivingDTO) {
    this.workerService.retrievingVideo(data.userId, data.videoId)
  }
}