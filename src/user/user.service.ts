import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { Repository } from 'typeorm';
import { UserDto } from './dto/user.dto';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  async findOne(userId: number): Promise<UserDto> {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      const { password, ...userDto } = user;
      return userDto as UserDto;
    } 

  async update(userId: number, updateUserDto: UpdateUserDto) {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      Object.assign(user, updateUserDto);
      await this.userRepo.save(user);
      this.logger.log(`User ${userId} updated`);
      return 'User updated successfully';
  }

  async remove(userId: number) {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      await this.userRepo.delete(userId);
      this.logger.log(`User ${userId} deleted`);
      return 'User Deleted successfully';
    } 
}
