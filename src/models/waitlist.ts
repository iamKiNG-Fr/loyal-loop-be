import {
    Table,
    Column,
    Model,
    DataType,
    Unique,
  } from "sequelize-typescript";
  

  @Table({ tableName: "waitlist", timestamps: true })
  class Waitlist extends Model {
    @Column(DataType.STRING)
    name!: string;

    @Column(DataType.STRING)
    businessName!: string;

    @Unique(true)
    @Column(DataType.STRING)
    email!: string;
  }
  
  export default Waitlist;
  