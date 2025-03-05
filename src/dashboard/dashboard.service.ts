import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateDashboardDto } from './dto/create-dashboard.dto';
import { UpdateDashboardDto } from './dto/update-dashboard.dto';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DashboardEntity,
  TagEntity,
  TaggableEntity,
} from './entities/dashboard.entity';
import { Repository } from 'typeorm';
import { UpdateDashboardQueryPositionDto } from './dto/update-dashboard-query-positions.dto';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(DashboardEntity)
    private dashboardRepo: Repository<DashboardEntity>,
  ) {}

  async create(userId: number, createDashboardDto: CreateDashboardDto) {
    try {
      const { name, databaseId, tags = [] } = createDashboardDto;

      // Check if the dashboard already exists
      const existingDashboard = await this.dashboardRepo.findOne({
        where: { name, userId, databaseId },
      });

      if (existingDashboard) {
        return { message: 'Dashboard with this name already exists' };
      }

      // Create the dashboard
      const dashboard = this.dashboardRepo.create({
        ...createDashboardDto,
        userId,
      });
      await this.dashboardRepo.save(dashboard);

      // Handle tags
      for (const tagName of tags) {
        // Check if tag already exists, create if not
        let tag = await this.dashboardRepo.manager.findOne(TagEntity, {
          where: { name: tagName },
        });
        if (!tag) {
          tag = this.dashboardRepo.manager.create(TagEntity, { name: tagName });
          await this.dashboardRepo.manager.save(TagEntity, tag);
        }

        // Create the taggable link
        const taggable = this.dashboardRepo.manager.create(TaggableEntity, {
          entityType: 'dashboard',
          entityId: dashboard.id,
          tagId: tag.id,
        });
        await this.dashboardRepo.manager.save(TaggableEntity, taggable);
      }

      return { message: 'Dashboard created successfully' };
    } catch (error) {
      if(error.code === '23503'){throw new BadRequestException('Invalid database ID or access denied')}
      this.logger.error(`Error creating dashboard: ${error.message}`);
      throw new InternalServerErrorException('Failed to create dashboard');
    }
  }

  async getCount(userId: number): Promise<{ count: number }> {
    try {
      const count = await this.dashboardRepo.count({ where: { userId } });
      return { count };
    } catch (error) {
      this.logger.error(
        `Failed to retrieve database count for user ${userId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve database count',
      );
    }
  }

  async findAll(
    userId: number,
    page: number = 1,
    limit: number = 10,
    search: string = '',
  ) {
    try {
      const offset = (page - 1) * limit;

      const queryBuilder = this.dashboardRepo
        .createQueryBuilder('dashboard')
        .leftJoinAndMapMany(
          'dashboard.tags',
          TaggableEntity,
          'taggable',
          'taggable.entityId = dashboard.id AND taggable.entityType = :entityType',
          { entityType: 'dashboard' },
        )
        .leftJoinAndMapOne(
          'taggable.tag',
          TagEntity,
          'tag',
          'taggable.tagId = tag.id',
        )
        .where('dashboard.userId = :userId', { userId });

      if (search) {
        queryBuilder.andWhere('dashboard.name ILIKE :search', {
          search: `%${search}%`,
        });
      }

      const [dashboards, count] = await queryBuilder
        .skip(offset)
        .take(limit)
        .getManyAndCount();

      // Map tags for each dashboard
      const dashboardsWithTags = dashboards.map((dashboard) => {
        const tags = (dashboard as any).tags
          ?.map((t) => t.tag?.name)
          .filter(Boolean);
        return { ...dashboard, tags };
      });

      return { dashboards: dashboardsWithTags, count };
    } catch (error) {
      this.logger.error(`Error fetching dashboards: ${error.message}`);
      throw new InternalServerErrorException("Couldn't fetch dashboards");
    }
  }

  async findOne(id: number, userId: number) {
    try {
      const dashboard = await this.dashboardRepo
        .createQueryBuilder('dashboard')
        .leftJoinAndMapMany(
          'dashboard.tags',
          TaggableEntity,
          'taggable',
          'taggable.entityId = dashboard.id AND taggable.entityType = :entityType',
          { entityType: 'dashboard' },
        )
        .leftJoinAndMapOne(
          'taggable.tag',
          TagEntity,
          'tag',
          'taggable.tagId = tag.id',
        )
        .where('dashboard.id = :id AND dashboard.userId = :userId', {
          id,
          userId,
        })
        .getOne();

      if (!dashboard) {
        throw new NotFoundException('Dashboard not found');
      }

      // Extract and map tags
      const tags = (dashboard as any).tags?.map((t) => t.tag?.name) || [];
      return { ...dashboard, tags };
    } catch (error) {
      this.logger.error(`Error fetching dashboard: ${error.message}`);
      throw new InternalServerErrorException("Couldn't fetch dashboard");
    }
  }

  async update(
    userId: number,
    id: number,
    updateDashboardDto: UpdateDashboardDto,
  ) {
    try {
      // Check if the dashboard exists and belongs to the user
      const existingDashboard = await this.dashboardRepo
        .createQueryBuilder('dashboard')
        .leftJoin('dashboard.database', 'database')
        .where('dashboard.id = :id', { id })
        .andWhere('database.userId = :userId', { userId })
        .getOne();

      if (!existingDashboard) {
        throw new NotFoundException('Dashboard not found or access denied');
      }

      // Update the dashboard entry with the new details (excluding tags)
      const updatedDashboard = this.dashboardRepo.merge(
        existingDashboard,
        updateDashboardDto,
      );

      await this.dashboardRepo.save(updatedDashboard);
      return { message: 'Dashboard updated successfully', updatedDashboard };
    } catch (error) {
      if(error instanceof BadRequestException){throw error}
      this.logger.error(`Failed to update dashboard ${id}: ${error.message}`);
      throw new InternalServerErrorException("Couldn't update dashboard");
    }
  }

  async updatePosition(
    dto: UpdateDashboardQueryPositionDto,
  ) {
    const { dashboardId, queryId, x, y, z, h } = dto;
    try {
      // Check if position already exists using query builder
      const existingPosition = await this.dashboardRepo
        .createQueryBuilder()
        .select('position')
        .from('dashboard_query_positions', 'position')
        .where('position.dashboardId = :dashboardId', { dashboardId })
        .andWhere('position.queryId = :queryId', { queryId })
        .getRawOne();

      if (existingPosition) {
        // Update position if it exists
        await this.dashboardRepo
          .createQueryBuilder()
          .update('dashboard_query_positions')
          .set({ x, y, z, h })
          .where('dashboardId = :dashboardId', { dashboardId })
          .andWhere('queryId = :queryId', { queryId })
          .execute();

        return'Position updated successfully';
      }

      // Insert new position if it does not exist
      await this.dashboardRepo
        .createQueryBuilder()
        .insert()
        .into('dashboard_query_positions')
        .values({
          dashboardId,
          queryId,
          x,
          y,
          z,
          h,
        })
        .execute();

      return'Position created successfully';
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to update dashboard ${dashboardId}: ${error.message}`,
      );
    }
  }

  async remove(userId: number, id: number) {
    try {
      const result = await this.dashboardRepo.delete(id);

      if (result.affected === 0) {
        throw new BadRequestException('Dashboard not found')
      }

      return 'Dashboard deleted successfully';
    } catch (error) {
      this.logger.error(`Failed to delete dashboard ${id}: ${error.message}`);

      if(error instanceof BadRequestException){
        throw error;
      }
      throw new InternalServerErrorException("Couldn't delete dashboard");
    }
  }

  async getDashboardInfo(id: number, userId: number) {
    try {
      const dashboard = await this.dashboardRepo.findOne({
        where: { id, userId },
        relations: ['queries', 'positions', 'positions.query'],
      });
  
      if (!dashboard) {
       throw new BadRequestException('Dashboard not found')
      }
  
      // Map positions to their corresponding queries
      const queriesWithPositions = dashboard.queries.map((query) => {
        const position = dashboard.positions.find(
          (pos) => pos.queryId === query.id
        );
  
        return {
          ...query,
          position: position
            ? {
                x: position.x,
                y: position.y,
                z: position.z,
                h: position.h,
              }
            : null,
        };
      });
  
      return {
        id: dashboard.id,
        name: dashboard.name,
        description: dashboard.description,
        createdAt: dashboard.createdAt,
        updatedAt: dashboard.updatedAt,
        databaseId: dashboard.databaseId,
        userId: dashboard.userId,
        queries: queriesWithPositions,
      };
    } catch (error) {

      if (error instanceof BadRequestException){
        throw error;
      }
      this.logger.error(`Failed to fetch dashboard ${id}: ${error.message}`);
      throw new InternalServerErrorException("Couldn't fetch dashboard");
    }
  }
}
