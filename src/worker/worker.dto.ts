import { IsString, IsNumber, IsNotEmpty } from 'class-validator'


export class VideoRetrivingDTO {
  @IsNumber()
  @IsNotEmpty()
  userId: number

  @IsString()
  @IsNotEmpty()
  videoId: string
}