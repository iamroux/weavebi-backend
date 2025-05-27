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

  async getQueryActivity(userId: number) {
    const response = await this.userRepo.query(
      `
    SELECT 
      DATE("createdAt") AS date,
      COUNT(*) AS queries_added
    FROM queries
    WHERE "userId" = $1 AND "createdAt" >= NOW() - INTERVAL '7 days'
    GROUP BY DATE("createdAt")
    ORDER BY DATE("createdAt") 
    LIMIT 100;
    `,
      [userId],
    );

    // Transform SQL result into Chart.js format
    const labels = response.map((item) => item.date.toISOString().slice(0, 10));
    const data = response.map((item) => parseInt(item.queries_added, 10));

    return {
      graph_type: 'bar',
      title: 'Queries You Have Added This Week',
      labels,
      datasets: [
        {
          label: 'Queries Added',
          data,
        },
      ],
    };
  }

  async getQueryTypes(userId: number) {
    const response = await this.userRepo.query(
      `
    SELECT "outputType", COUNT(*) AS count
    FROM queries
    WHERE "userId" = $1
    GROUP BY "outputType"
    ORDER BY count DESC
    LIMIT 100;
    `,
      [userId],
    );

    // Define custom label mappings
    const labelMap: Record<string, string> = {
      tabular: 'tables',
      singleValue: 'single values',
    };

    const labels = response.map((item) => {
      const raw = item.outputType;

      // If explicitly mapped, use it
      if (labelMap[raw]) return labelMap[raw];

      // Otherwise, pluralize simple cases (e.g., "bar chart" → "bar charts")
      return raw.endsWith('s') ? raw : `${raw}s`;
    });

    const data = response.map((item) => parseInt(item.count, 10));

    return {
      graph_type: 'doughnut',
      title: 'Distribution of Your Query Outputs',
      labels,
      datasets: [
        {
          label: 'Query Count',
          data,
        },
      ],
    };
  }
}
