import {
  Catch,
  ArgumentsHost,
  HttpException,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalExceptionFilter');

  catch(error: Error, host: ArgumentsHost) {
    this.logger.error(`Global Exception Handler: ${error.message}`);

    const response = host.switchToHttp().getResponse();
    if (error instanceof HttpException) {
      const errorResponse = error.getResponse();
      response.status(error.getStatus()).json({
        message: errorResponse['message'] || null,
        error: errorResponse['error'] || null,
      });
    } else {
      response.status(500).json({
        message: 'Something unexpected occurred',
        error: 'Internal Server Error',
      });
    }
  }
}
