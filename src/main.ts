import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: true,
    bodyParser: true
  });

  const config = new DocumentBuilder()
    .setTitle(process.env.API_TITLE ?? 'WeaveBI')
    .setDescription(
      process.env.API_DESCRIPTION ?? 'Data visualization dashboards app',
    )
    .setVersion(process.env.API_VERSION ?? '1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });


  await app.listen(process.env.APP_PORT ?? 3000);
}
bootstrap();
