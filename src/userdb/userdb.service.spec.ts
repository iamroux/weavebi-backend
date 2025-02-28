import { Test, TestingModule } from '@nestjs/testing';
import { UserdbService } from './userdb.service';

describe('UserdbService', () => {
  let service: UserdbService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UserdbService],
    }).compile();

    service = module.get<UserdbService>(UserdbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
