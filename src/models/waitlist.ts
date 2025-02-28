import { Table, Column, Model, DataType, Unique } from "sequelize-typescript";

@Table({ tableName: "waitlist", timestamps: true })
class Waitlist extends Model {
  @Column(DataType.STRING)
  name!: string;

  @Column(DataType.STRING)
  businessName!: string;

  @Unique(true)
  @Column(DataType.STRING)
  email!: string;

  // Override toJSON to exclude `id`
  toJSON() {
    const values = { ...this.get() };
    delete values.id; // Exclude id from the response
    return values;
  }
}
export default Waitlist;
