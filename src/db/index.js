import mongoose from "mongoose";
import {DB_NAME} from "../constants.js";


const connectDB = async ()=>{
    try {
     const connectinInstance =  await mongoose.connect(`${process.env.MONGODB_URL}/${DB_NAME}`) 
     console.log(`\n MongoDB connected !! DB HOST:${connectinInstance.connection.host}`);
    } catch (error) {
       console.log("MONGODM connection error ",error);
   process.exit(1);
    }
}

export default connectDB;