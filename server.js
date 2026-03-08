const express = require("express");
const multer = require("multer");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");

const app = express();
const db = new sqlite3.Database("./complaints.db");

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));
app.use(express.json());

const storage = multer.diskStorage({
destination: function(req,file,cb){
cb(null,"uploads/");
},
filename: function(req,file,cb){
cb(null,Date.now()+"-"+file.originalname);
}
});

const upload = multer({storage:storage});

db.run(`CREATE TABLE IF NOT EXISTS complaints(
id TEXT PRIMARY KEY,
title TEXT,
category TEXT,
description TEXT,
file TEXT,
status TEXT,
action_taken TEXT,
action_date TEXT
)`);

app.post("/register-complaint", upload.single("file"), (req,res)=>{

const id = uuidv4().slice(0,8);

const title = req.body.title;
const category = req.body.category;
const description = req.body.description;

const file = req.file ? req.file.filename : null;

db.run(
"INSERT INTO complaints VALUES(?,?,?,?,?,?,?,?)",
[id,title,category,description,file,"Pending","Not yet","-"],
(err)=>{
if(err){
return res.json({error:"Database error"});
}

res.json({
id:id,
title:title,
status:"Pending"
});
}
);

});

app.get("/track/:id", (req,res)=>{

const id = req.params.id;

db.get(
"SELECT id,title,status,action_taken,action_date FROM complaints WHERE id=?",
[id],
(err,row)=>{

if(err){
return res.json({error:"Database error"});
}

if(!row){
return res.json({error:"Complaint not found"});
}

res.json(row);

});

});
app.get("/admin/complaints", (req,res)=>{

db.all("SELECT * FROM complaints",(err,rows)=>{

if(err){
return res.json({error:"Database error"});
}

res.json(rows);

});

});
app.post("/admin/update",(req,res)=>{

const {id,status,action_taken,action_date} = req.body;

db.run(
"UPDATE complaints SET status=?, action_taken=?, action_date=? WHERE id=?",
[status,action_taken,action_date,id],
function(err){

if(err){
return res.json({error:"Update failed"});
}

res.json({success:true});

});

});

app.listen(3000,()=>{
console.log("Server running on http://localhost:3000");
});