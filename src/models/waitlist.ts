import { Table, Column, Model, DataType, Unique, AllowNull } from "sequelize-typescript";

@Table({ tableName: "waitlist", timestamps: true })
class Waitlist extends Model {
  @AllowNull(false)
  @Column(DataType.STRING)
  name!: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  businessName!: string;
  
  @AllowNull(false)
  @Unique(true)
  @Column(DataType.STRING)
  email!: string;

  @Unique(true)
  @Column(DataType.STRING)
  refCode!: string;
  
  @AllowNull(true)
  @Column(DataType.STRING)
  refBy!: string;
  
  // Override toJSON to exclude `id`
  toJSON() {
    const values = { ...this.get() };
    delete values.id; // Exclude id from the response
    return values;
  }
}
export default Waitlist;
