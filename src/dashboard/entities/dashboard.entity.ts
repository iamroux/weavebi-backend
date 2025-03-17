export class Dashboard {}
import { QueryEntity } from 'src/query/entities/query.entity';
import { UserdbEntity } from 'src/userdb/entities/userdb.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  PrimaryColumn,
  BeforeUpdate,
  BeforeInsert,
} from 'typeorm';

@Entity('dashboards')
export class DashboardEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  description: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column()
  databaseId: number;

  @Column({ default: false })
  isPinned: boolean;

  @Column()
  userId: number;

  @ManyToOne(() => UserEntity, (user) => user.dashboards, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;
  @ManyToOne(() => UserdbEntity, (database) => database.dashboards, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'databaseId' })
  database: UserdbEntity;

  @ManyToMany(() => QueryEntity, (query) => query.dashboards, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  queries: QueryEntity[];

  @OneToMany(
    () => DashboardQueryPositionEntity,
    (position) => position.dashboard,
  )
  positions: DashboardQueryPositionEntity[];

  @BeforeUpdate()
  @BeforeInsert()
  normalizeName() {
    if(this.name){
      this.name = this.name.toLowerCase()
    }
  }
}

@Entity('dashboard_query_positions')
export class DashboardQueryPositionEntity {
  @PrimaryColumn()
  dashboardId: number;

  @PrimaryColumn()
  queryId: number;

  @Column({ type: 'int' })
  x: number;

  @Column({ type: 'int' })
  y: number;

  @Column({ type: 'int' })
  z: number;

  @Column({ type: 'int' })
  h: number;

  @ManyToOne(() => DashboardEntity, (dashboard) => dashboard.positions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'dashboardId' })
  dashboard: DashboardEntity;

  @ManyToOne(() => QueryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'queryId' })
  query: QueryEntity;
}

@Entity('tags')
export class TagEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string;
  @OneToMany(() => TaggableEntity, (taggable) => taggable.tag)
  taggables: TaggableEntity[];

  @BeforeInsert()
  @BeforeUpdate()
  normalizeName() {
    if(this.name){
      this.name = this.name.toLowerCase();
    }
  }
}

@Entity('taggable')
export class TaggableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  entityType: string;

  @Column()
  entityId: number;

  @Column()
  tagId: number;

  @ManyToOne(() => TagEntity, (tag) => tag.taggables, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tagId' })
  tag: TagEntity;
}
