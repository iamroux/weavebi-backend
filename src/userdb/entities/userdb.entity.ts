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
import { 
  createCipheriv, 
  randomBytes, 
  scrypt 
} from 'crypto';
import { promisify } from 'util';


@Entity('databases')
export class UserdbEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({nullable: true})
  connectionName: string;

  @Column({nullable: true})
  description: string

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

  private getEncryptionSalt(): string {
    const salt = process.env.ENCRYPTION_SALT;
    if(!salt){
      throw new Error('namak haraam')
    }
    return salt;
  }

  private async deriveKey(password: string): Promise<Buffer> {
    const salt = this.getEncryptionSalt();
    return await promisify(scrypt)(password, salt, 32) as Buffer;
  }

  private async encrypt(text: string): Promise<string> {
    try {
      const iv = randomBytes(16);
      const encryptionPassword = process.env.ENCRYPTION_PASSWORD;
      if (!encryptionPassword){
        throw new Error('Encryption password not found in')
      }
      const key = await this.deriveKey(encryptionPassword);
      const cipher = createCipheriv('aes-256-ctr', key, iv);
      const encryptedText = Buffer.concat([
        cipher.update(text, 'utf8'),
        cipher.final()
      ]);

      return `${iv.toString('hex')}:${encryptedText.toString('hex')}`;
    } catch (error) {
      console.error('Encryption error:', error);
      throw error;
    }
  }


  @BeforeInsert()
  @BeforeUpdate()
  async encryptPassword() {
    if (this.password && !this.password.includes(':')) {
      this.password = await this.encrypt(this.password);
    }
  }
}
