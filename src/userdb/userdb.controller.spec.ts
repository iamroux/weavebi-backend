import { Test, TestingModule } from '@nestjs/testing';
import { UserdbController } from './userdb.controller';
import { UserdbService } from './userdb.service';

describe('UserdbController', () => {
  let controller: UserdbController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserdbController],
      providers: [UserdbService],
    }).compile();

    controller = module.get<UserdbController>(UserdbController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
