import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { MessageDto } from './core/dtos/generic-response.dto';
import { ApiOperation } from '@nestjs/swagger';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('ping')
  @ApiOperation({ summary: 'Ping the server' })
  async getHello(): Promise<MessageDto> {
    const message = this.appService.getHello();
    return { message };
  }
}
