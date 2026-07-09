"""
Precise document size measurement by collection.
"""
import os
import asyncio
import json
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URI"])
    db = client[os.environ.get("MONGO_DB_NAME", "ielts_platform")]

    colls = ["centers", "users", "groups", "tests", "assignments", "results"]
    
    for coll_name in colls:
        print(f"\n=== {coll_name} ===")
        total_bson = 0
        count = 0
        min_sz = 999999
        max_sz = 0
        
        async for doc in db[coll_name].find({}, {"_id": 1}):
            bson_size = len(doc.raw) if hasattr(doc, 'raw') else 0
            count += 1
            
        # Get one sample doc to measure
        sample = await db[coll_name].find_one()
        if sample:
            # Get full BSON size via raw
            pipeline = [{"$sample": {"size": 1}}, {"$project": {"size": {"$bsonSize": "$$ROOT"}}}]
            try:
                async for d in db[coll_name].aggregate(pipeline):
                    bson_size = d.get("size", 0)
                    print(f"  Full doc BSON size: {bson_size} B ({bson_size/1024:.2f} KB)")
                    
                    # Compare: indexed fields
                    indexed_pipeline = [{"$sample": {"size": 1}}, {"$project": {"size": {"$bsonSize": {"_id": "$_id"}}}}]
                    async for d2 in db[coll_name].aggregate(indexed_pipeline):
                        id_size = d2.get("size", 0)
                        print(f"  _id field size: {id_size} B")
            except Exception as e:
                print(f"  ERR: {e}")

        coll_stats = await db.command("collStats", coll_name)
        count = coll_stats.get("count", 0)
        avg_obj = coll_stats.get("avgObjSize", 0) if count > 0 else 0
        data_size = coll_stats.get("size", 0)
        storage = coll_stats.get("storageSize", 0)
        index_size = coll_stats.get("totalIndexSize", 0)
        nindexes = coll_stats.get("nindexes", 0)
        
        print(f"  Documents: {count}")
        print(f"  Avg obj size: {avg_obj} B")
        print(f"  Data size: {data_size} B ({data_size/1024:.1f} KB)")
        print(f"  Storage: {storage} B ({storage/1024:.1f} KB)")
        print(f"  Indexes: {nindexes}  Index size: {index_size} B ({index_size/1024:.1f} KB)")


asyncio.run(main())
