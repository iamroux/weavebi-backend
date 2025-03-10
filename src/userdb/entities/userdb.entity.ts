import { DashboardEntity } from 'src/dashboard/entities/dashboard.entity';
import { QueryEntity } from 'src/query/entities/query.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { createCipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';
import { EncryptionService } from 'src/query/encryption.service';

@Entity('databases')
export class UserdbEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  connectionName: string;

  @Column({ nullable: true })
  description: string;

  @Column()
  provider: string;

  @Column()
  name: string;

  @Column()
  username: string;

  @Column()
  password: string;

  @Column()
  host: string;

  @Column()
  port: number;

  @Column({ nullable: true })
  schema: string;
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column()
  userId: number;

  @ManyToOne(() => UserEntity, (user) => user.databases, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @OneToMany(() => QueryEntity, (query) => query.database)
  queries: QueryEntity[];

  @OneToMany(() => DashboardEntity, (dashboard) => dashboard.database)
  dashboards: DashboardEntity[];

  private static encryptionService: EncryptionService;
  public static setEncryptoinService(service: EncryptionService) {
    UserdbEntity.encryptionService = service;
  }

  @BeforeInsert()
  @BeforeUpdate()
  async encryptPassword() {
    // Only encrypt if the password is not already encrypted and the service is available
    if (
      this.password &&
      !this.password.includes(':') &&
      UserdbEntity.encryptionService
    ) {
      this.password = await UserdbEntity.encryptionService.encrypt(
        this.password,
      );
    }
  }
}
