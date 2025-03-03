import { DashboardEntity } from 'src/dashboard/entities/dashboard.entity';
import { UserdbEntity } from 'src/userdb/entities/userdb.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('queries')
export class QueryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  query: string;

  @Column()
  outputType: string;

  @Column({ nullable: true })
  generatedSqlQuery: string;

  @Column({ nullable: true })
  data: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column()
  databaseId: number;

  @Column()
  userId: number;

  @ManyToOne(() => UserEntity, (user) => user.queries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @ManyToOne(() => UserdbEntity, (database) => database.queries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'databaseId' })
  database: UserdbEntity;

  @ManyToMany(() => DashboardEntity, (dashboard) => dashboard.queries)
  @JoinTable({
    name: 'dashboard_query',
    joinColumn: { name: 'queryId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'dashboardId', referencedColumnName: 'id' },
  })
  dashboards: DashboardEntity[];
}
