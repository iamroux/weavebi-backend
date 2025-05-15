import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello() {
    return {
      name: 'WeaveBI Backend',
      version: '1.0.0',
    };
  }
}
