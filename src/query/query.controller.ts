import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
  ParseBoolPipe,
  HttpCode,
  HttpStatus,
  Res,
  ParseIntPipe,
} from '@nestjs/common';
import { QueryService } from './query.service';
import { CreateQueryDto } from './dto/create-query.dto';
import { AuthGuard } from 'src/core/guards/auth.guard';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { MessageDto } from 'src/core/dtos/generic-response.dto';
import { QueryEntity } from './entities/query.entity';
import { LinkQueryToDashboardDto } from './dto/link-query-to-dashboard.dto';
import { ExecuteQueryDto } from './dto/execute-query.dto';
import { Response } from 'express';

@Controller('query')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Post()
  @ApiOperation({ summary: 'Save a query.' })
  @ApiProperty({ type: CreateQueryDto })
  @ApiResponse({ type: CreateQueryDto })
  async create(@Request() req, @Body() createQueryDto: CreateQueryDto) {
    const userId = req.user.id;
    return await this.queryService.create(userId, createQueryDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a query.' })
  @ApiProperty({ type: CreateQueryDto })
  @ApiResponse({ type: MessageDto })
  async update(
    @Request() req,
    @Param('id') id: number,
    @Body() createQueryDto: CreateQueryDto,
  ) {
    const userId = req.user.id;
    const message = await this.queryService.update(userId, id, createQueryDto);
    return { message };
  }

  @Get('run:id')
  @ApiOperation({ summary: 'Run an existant query and save output.' })
  @ApiProperty({ type: MessageDto })
  @ApiResponse({ type: QueryEntity })
  async runQuery(@Param('id') queryId: string, @Request() req) {
    const userId = req.user.id;
    return await this.queryService.runQuery(+queryId, userId);
  }

  @Post('save-run')
  @ApiOperation({
    summary: 'Run and/or save a query by providing query info.',
  })
  // @ApiResponse({ type: QueryEntity })
  @ApiBody({ type: CreateQueryDto })
  @ApiQuery({
    name: 'save',
    type: 'boolean',
    required: false,
    description: 'Option to save the query',
  })
  async directRunQuery(
    @Request() req,
    @Body() createQueryDto: CreateQueryDto,
    @Query('save', ParseBoolPipe) save: boolean,
  ) {
    const userId = req.user.id;
    return await this.queryService.directRunQuery(userId, createQueryDto, save);
  }

  @Post('execute')
  @ApiOperation({
    summary: 'simply execute an sql query in the provided database',
  })
  async execute(@Body() executeQueryDto: ExecuteQueryDto, @Request() req) {
    const userId = req.user.id;
    return await this.queryService.execute(executeQueryDto, userId);
  }

  @Post('link-to-dashboard')
  @ApiOperation({ summary: 'Link a query to a dashboard.' })
  @ApiProperty({ type: LinkQueryToDashboardDto })
  @ApiResponse({ type: MessageDto })
  async linkQueryToDashboard(
    @Body() linkQueryToDashboardDto: LinkQueryToDashboardDto,
    @Request() req,
  ) {
    const { queryId, dashboardId } = linkQueryToDashboardDto;
    const userId = req.user.id; // Get userId from authenticated request
    const message = await this.queryService.linkQueryToDashboard(
      userId,
      queryId,
      dashboardId,
    );
    return { message };
  }

  @Post('unlink-from-dashboard')
  @ApiOperation({ summary: 'Unlink a query from a dashboard.' })
  @ApiProperty({ type: LinkQueryToDashboardDto })
  @ApiResponse({ type: MessageDto })
  @HttpCode(HttpStatus.OK)
  async unlinkQueryFromDashboard(
    @Body() linkQueryToDashboardDto: LinkQueryToDashboardDto,
    @Request() req,
  ) {
    const { queryId, dashboardId } = linkQueryToDashboardDto;
    const userId = req.user.id; // Get userId from authenticated request
    const message = await this.queryService.unlinkQueryFromDashboard(
      userId,
      queryId,
      dashboardId,
    );
    return { message };
  }

  @Get('sync:id')
  @ApiOperation({ summary: 'Parallel exeute all queries in a dashboard..' })
  @ApiProperty({ type: MessageDto })
  @ApiResponse({ type: QueryEntity })
  async runDashboard(@Param('id') dashboardId: string, @Request() req) {
    const userId = req.user.id;
    const message = await this.queryService.runDashboard(+dashboardId, userId);
    return { message };
  }

  @Get('database-queries/:databaseId')
  @ApiOperation({ summary: 'Get all queries belonging to a database.' })
  @ApiProperty({ type: Number })
  @ApiResponse({ type: [QueryEntity] })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number for pagination',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items per page',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term for name or query',
  })
  async getDatabaseQueries(
    @Param('databaseId') databaseId: number,
    @Request() req,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search: string = '',
  ) {
    const userId = req.user.id;
    return await this.queryService.getDatabaseQueries(
      databaseId,
      userId,
      page,
      limit,
      search,
    );
  }

  @Get('count-database')
  @ApiOperation({ summary: 'Get count of queries belonging to a database' })
  @ApiProperty({ type: Number })
  @ApiResponse({ type: Number })
  async getQueryCountforDatabase(
    @Param('databaseId') databaseId: number,
    @Request() req,
  ) {
    const userId = req.userId;
    return await this.queryService.getQueryCountForDatabase(databaseId, userId);
  }

  @Get('count-dashboard')
  @ApiOperation({ summary: 'Get count of queries belonging to a dashboard' })
  @ApiProperty({ type: Number })
  @ApiResponse({ type: Number })
  async getQueryCountforDashboard(@Param('dashboardId') dashboardId: number) {
    return await this.queryService.getQueryCountForDashboard(dashboardId);
  }

  @Get('count-executed')
  @ApiOperation({
    summary: 'Get count of queries that have been executed by user.',
  })
  @ApiProperty({ type: Number })
  @ApiResponse({ type: Number })
  async getExecutedQueryCount(@Request() req) {
    const userId = req.user.id;
    return await this.queryService.getExecutedQueryCount(userId);
  }

  @Get('dashboard-queries/:dashboardId')
  @ApiOperation({ summary: 'Get all queries belonging to a dashboard.' })
  @ApiProperty({ type: Number })
  @ApiResponse({ type: [QueryEntity] })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number for pagination',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items per page',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search term for name or query',
  })
  async getDashboardQueries(
    @Param('dashboardId') dashboardId: number,
    @Request() req,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search: string = '',
  ) {
    const userId = req.user.id;
    return await this.queryService.getDashboardQueries(
      dashboardId,
      userId,
      page,
      limit,
      search,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a query.' })
  @ApiProperty({ type: Number })
  @ApiResponse({ type: MessageDto })
  async remove(@Request() req, @Param('id') id: number) {
    const userId = req.user.id;
    const message = await this.queryService.remove(id, userId);
    return { message };
  }

  @Get('suggest/:databaseId')
  @ApiOperation({ summary: 'Suggest queries for a database.' })
  @ApiProperty({ type: Number })
  @ApiResponse({ type: [QueryEntity] })
  async suggestQueries(
    @Param('databaseId') databaseId: number,
    @Request() req,
  ) {
    const userId = req.user.id;
    return await this.queryService.suggestQueries(databaseId, userId);
  }

  // @Get('mappings')
  // @ApiOperation({ summary: 'Generate mappings' })
  // @ApiProperty({ type: Number })
  // @ApiResponse({ type: [QueryEntity] })
  // async generateMappings(
  // ) {
  //   return await this.queryService.generateMappings();
  // }

  @Get('insights/:queryId')
  @ApiOperation({ summary: 'Get insights for a query.' })
  @ApiProperty({ type: Number })
  @ApiResponse({ type: [QueryEntity] })
  @ApiQuery({
    name: 'search',
    type: 'boolean',
    required: false,
    description: 'Option to use internet for insights',
  })
  @ApiQuery({
    name: 'customInstructions',
    type: 'string',
    required: false,
    description: 'Custom instructions for insights',
  })
  async getQueryInsights(
    @Param('queryId') queryId: number,
    @Request() req,
    @Query('search') search: boolean,
    @Query('customInstructions') customInstructions: string,
  ) {
    const userId = req.user.id;
    return await this.queryService.getQueryInsights(
      queryId,
      userId,
      search,
      customInstructions,
    );
  }

  @Get('sample-dashboard/:databaseId')
  @ApiOperation({ summary: 'Generate a sample dashboard for new user' })
  @ApiResponse({ type: MessageDto })
  async generateDashboard(
    @Param('databaseId') databaseId: number,
    @Request() req,
  ) {
    const userId = req.user.id;
    const message = await this.queryService.generateDashboard(
      databaseId,
      userId,
    );
    return { message };
  }

  @Get('download-json/:queryId')
  @ApiOperation({ summary: 'Download a qury output in json' })
  async downloadQueryDataAsJson(
    @Param('queryId', ParseIntPipe) queryId: number,
    @Res() res: Response,
    @Request() req,
  ) {
    const userId = req.user.id;
    const data = await this.queryService.getQueryDataAsJson(queryId, userId);

    const filename = `query-${queryId}-data.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(data);
  }

  @Get('download-csv/:queryId')
  @ApiOperation({ summary: 'Download a qury output in csv' })
  async downloadQueryDataAsCsv(
    @Param('queryId', ParseIntPipe) queryId: number,
    @Res() res: Response,
    @Request() req,
  ) {
    const userId = req.user.id;
    const csvContent = await this.queryService.getQueryDataAsCsv(
      queryId,
      userId,
    );

    const filename = `query-${queryId}-data.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csvContent);
  }

  @Get()
  @ApiOperation({ summary: 'Get a query using id.' })
  @ApiResponse({ type: QueryEntity })
  async findOne(@Request() req, @Query('id') id: number) {
    const userId = req.user.id;
    return await this.queryService.findOne(id, userId);
  }
}
