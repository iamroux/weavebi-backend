import {
  BadRequestException,
  ConflictException,
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
import { UpdateDashboardQueryPositionsDto } from './dto/update-dashboard-query-positions.dto';
import {
  DashboardQueryColorDto,
  UpdateDashboardQueryColorDto,
} from './dto/update-dashboard-query-color.dto';
import { UpdateDashboardQueryLabelDto } from './dto/update-dashboard-query-label.dto';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(DashboardEntity)
    private readonly dashboardRepo: Repository<DashboardEntity>,
  ) {}

  async create(userId: number, createDashboardDto: CreateDashboardDto) {
      const { name, databaseId, tags = [] } = createDashboardDto;

      // Check if the dashboard already exists
      const normalizedName = name.toLowerCase();

      const existingDashboard = await this.dashboardRepo.findOne({
        where: { name: normalizedName, userId, databaseId },
      });

      if (existingDashboard) {
        this.logger.warn(
          `Dashboard with name '${normalizedName}' already exists.`,
        );
        throw new ConflictException('Dashboard with same name already exists.');
      }

      // check if databaseId is valid
      const database = await this.dashboardRepo.findOne({
        where: {database: {id: databaseId}, userId},
      })
      // const database = await this.dashboardRepo.findOne({
      //   where: {databaseId: createDashboardDto.databaseId, userId: userId},
      // })
      // if (!database) {
      //   this.logger.warn(
      //     `Database with id '${createDashboardDto.databaseId}' not found.`,
      //   );
      //   throw new BadRequestException('Database not found');
      // }

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
          where: { name: tagName.toLowerCase() },
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
      this.logger.log(`Dashboard ${dashboard.id} created for user ${userId}`);

      return {
        message: 'Dashboard created successfully',
        dashboard: dashboard,
      };
    }

  async getCount(userId: number): Promise<{ count: number }> {
      const count = await this.dashboardRepo.count({ where: { userId } });
      return { count };
    } 

  async findAll(
    userId: number,
    page: number = 1,
    limit: number = 10,
    search: string = '',
    sortBy: string = 'createdAt',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    isPinned: boolean = false,
  ) {
  
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

      if (isPinned) {
        queryBuilder.andWhere('dashboard.isPinned = :isPinned', { isPinned });
      }

      const validSortFields = ['createdAt', 'updatedAt'];
      const validSortBy = validSortFields.includes(sortBy)
        ? sortBy
        : 'createdAt';
      const validSortOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';

      queryBuilder.orderBy(`dashboard.${validSortBy}`, validSortOrder);

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
    } 

  async findOne(id: number, userId: number) {
  
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
    } 

  async update(
    userId: number,
    id: number,
    updateDashboardDto: UpdateDashboardDto,
  ) {
 
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
      this.logger.log(
        `Dashobard ${updatedDashboard.id} updated for user ${userId}`,
      );
      return { message: 'Dashboard updated successfully', updatedDashboard };
    }

  async updatePositions(dto: UpdateDashboardQueryPositionsDto) {
    const { positions } = dto;


      const results = [];

      // Process each position in the array
      for (const position of positions) {
        const { dashboardId, queryId, x, y, z, h } = position;

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
        } else {
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
        }

        this.logger.log(
          `Layout for query: ${queryId} dashboard ${dashboardId} updated`,
        );
      }

      return `Successfully processed ${positions.length} position updates`;
    } 

  async updateColors(dto: UpdateDashboardQueryColorDto) {
    console.log('works here')
    const { colors } = dto;
      // Process each color in the array
      for (const color of colors) {
        const { dashboardId, queryId, chartColor, titleColor } = color;

        // insert/update chartColor, titleColor in dashboard_query_positions table
        await this.dashboardRepo
          .createQueryBuilder()
          .insert()
          .into('dashboard_query_positions')
          .values({
            dashboardId,
            queryId,
            chartColor,
            titleColor,
          })
          .orUpdate(
            ['chartColor', 'titleColor'],
            ['dashboardId', 'queryId'],
          )
          .execute();
        this.logger.log(
          `Colors for query: ${queryId} dashboard ${dashboardId} updated`,
        );
      }
      console.log('works here3')
      return `Successfully updated colors`;
    } 

  async remove(userId: number, id: number) {
    const dashboard = await this.dashboardRepo.findOne({
      where: { id, userId },
    });
    if (!dashboard) {
      throw new BadRequestException('Dashboard not found or unauthorized');
    }
      await this.dashboardRepo.query(
        `DELETE FROM taggable WHERE "entityId" = $1 AND "entityType" = 'dashboard'`,
        [id],
      );
      const result = await this.dashboardRepo.delete(id);

      if (result.affected === 0) {
        throw new BadRequestException('Dashboard not found');
      }
      this.logger.log(`Dashboard ${id} deleted  for user ${userId}`);

      return 'Dashboard deleted successfully';
    }

  async getDashboardInfo(id: number, userId: number) {
 
      const dashboard = await this.dashboardRepo.findOne({
        where: { id, userId },
        relations: ['queries', 'positions', 'positions.query'],
      });

      if (!dashboard) {
        throw new BadRequestException('Dashboard not found');
      }

      // Map positions to their corresponding queries
      const queriesWithPositions = dashboard.queries.map((query) => {
        const position = dashboard.positions.find(
          (pos) => pos.queryId === query.id,
        );

        return {
          ...query,
          data:
            query.outputType === 'descriptive'
              ? query.data
              : JSON.parse(query.data), // parse JSON data
          position: position
            ? {
                x: position.x,
                y: position.y,
                z: position.z,
                h: position.h,
              }
            : null,
          colors: position
            ? {
                chartColor: position.chartColor,
                titleColor: position.titleColor,
              }
            : null,
          xAxisLabel: position ? position.xAxisLabel : null,
          yAxisLabel: position ? position.yAxisLabel : null,
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
    } 

  async togglePin(id: number, userId: number) {

      const dashboard = await this.dashboardRepo.findOne({
        where: { id, userId },
      });
      if (!dashboard) {
        throw new BadRequestException('Dashboard not found or unauthorized');
      }
      // toggle pinned status
      dashboard.isPinned = !dashboard.isPinned;
      await this.dashboardRepo.save(dashboard);
      return `Dashboard ${dashboard.isPinned ? 'pinned' : 'unpinned'} successfully`;
    } 

  async updateQueryLabel(
    updateDashboardQueryLabelDto: UpdateDashboardQueryLabelDto,
    userId: number,
  ) {
    const dashboard = await this.dashboardRepo.findOne({
      where: { id: updateDashboardQueryLabelDto.dashboardId, userId },
    });
    const query = await this.dashboardRepo.findOne({
      where: { queries: { id: updateDashboardQueryLabelDto.queryId, userId } },
    });
    if (!dashboard || !query) {
      throw new BadRequestException('Dashboard or query not found');
    }
      // push new values in dashboard_query_positions table
      await this.dashboardRepo
        .createQueryBuilder()
        .update('dashboard_query_positions')
        .set({
          xAxisLabel: updateDashboardQueryLabelDto.XAxislabel,
          yAxisLabel: updateDashboardQueryLabelDto.YAxislabel,
        })
        .where('dashboardId = :dashboardId', {
          dashboardId: updateDashboardQueryLabelDto.dashboardId,
        })
        .andWhere('queryId = :queryId', {
          queryId: updateDashboardQueryLabelDto.queryId,
        })
        .execute();

      return 'Query label updated successfully';
    } 
}
