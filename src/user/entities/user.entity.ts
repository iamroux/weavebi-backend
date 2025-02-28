export class User {}
import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IsEmail, Length } from 'class-validator';
import { UserdbEntity } from 'src/userdb/entities/userdb.entity';
import { QueryEntity } from 'src/query/entities/query.entity';
import { DashboardEntity } from 'src/dashboard/entities/dashboard.entity';
import * as argon2 from 'argon2';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ unique: true })
  @IsEmail()
  email: string;

  @Column()
  @Length(6, 32)
  password: string;

  @Column()
  name: string;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @OneToMany(() => UserdbEntity, (database) => database.user)
  databases: UserdbEntity[];

  @OneToMany(() => QueryEntity, (query) => query.user)
  queries: QueryEntity[];

  @OneToMany(() => DashboardEntity, (dashboard) => dashboard.user)
  dashboards: DashboardEntity[];

  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword() {
    this.password = await argon2.hash(this.password);
  }
}
