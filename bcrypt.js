import bcrypt from "bcrypt";

console.log(await bcrypt.hash("1234", 10));
console.log(await bcrypt.hash("pass", 10));