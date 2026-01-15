from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from bson import ObjectId
import httpx
import pandas as pd
from io import BytesIO

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Helper function to convert ObjectId to string
def serialize_doc(doc):
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc

# ==================== MODELS ====================

class Habit(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    name: str
    description: Optional[str] = None
    category: str = "general"  # health, work, learning, personal
    frequency: str = "daily"  # daily, weekly, custom
    target_days: List[int] = [0, 1, 2, 3, 4, 5, 6]  # 0=Monday, 6=Sunday
    strength_score: float = 0.0  # 0-100
    streak_current: int = 0
    streak_best: int = 0
    color: str = "#6366f1"  # indigo
    icon: str = "✓"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_active: bool = True
    
    # Habit Sequencing Fields
    impact: int = 3  # 1-5: Life-changing impact
    difficulty: int = 3  # 1-5: Willpower requirement
    priority: str = "important_not_urgent"  # eisenhower matrix
    status: str = "queued"  # active, queued, paused
    focus_score: float = 0.0  # Calculated priority score
    activated_at: Optional[datetime] = None

    class Config:
        populate_by_name = True

class HabitCreate(BaseModel):
    name: str
    description: Optional[str] = None
    category: str = "general"
    frequency: str = "daily"
    target_days: List[int] = [0, 1, 2, 3, 4, 5, 6]
    color: str = "#6366f1"
    icon: str = "✓"
    
    # Habit Sequencing Fields
    impact: int = 3  # 1-5
    difficulty: int = 3  # 1-5
    priority: str = "important_not_urgent"  # urgent_important, important_not_urgent, urgent_not_important, neither

class Task(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    title: str
    description: Optional[str] = None
    category: str = "general"
    due_date: Optional[datetime] = None
    time_block_start: Optional[str] = None  # "14:00"
    time_block_end: Optional[str] = None    # "15:00"
    completed: bool = False
    completed_at: Optional[datetime] = None
    is_subtask: bool = False
    parent_task_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    category: str = "general"
    due_date: Optional[datetime] = None
    time_block_start: Optional[str] = None
    time_block_end: Optional[str] = None
    is_subtask: bool = False
    parent_task_id: Optional[str] = None

class Completion(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    habit_id: str
    completed_at: datetime = Field(default_factory=datetime.utcnow)
    notes: Optional[str] = None
    mood: Optional[int] = None  # 1-5 rating

    class Config:
        populate_by_name = True

class CompletionCreate(BaseModel):
    habit_id: str
    notes: Optional[str] = None
    mood: Optional[int] = None

class Webhook(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    url: str
    event_types: List[str] = ["habit_completed", "task_completed"]
    headers: Optional[Dict[str, str]] = None
    enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True

class WebhookCreate(BaseModel):
    url: str
    event_types: List[str] = ["habit_completed", "task_completed"]
    headers: Optional[Dict[str, str]] = None

class BadHabit(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    name: str
    description: Optional[str] = None
    quit_date: datetime
    cost_per_day: float = 0.0  # Money spent per day
    time_wasted_per_day: int = 0  # Minutes wasted per day
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True

class BadHabitCreate(BaseModel):
    name: str
    description: Optional[str] = None
    quit_date: datetime
    cost_per_day: float = 0.0
    time_wasted_per_day: int = 0

class UserProfile(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    user_id: str = "default"  # For multi-user support later
    level: int = 1
    total_xp: int = 0
    current_level_xp: int = 0
    next_level_xp: int = 100
    willpower_rank: str = "Acemi"  # Acemi, Disiplinli, Uzman, Master, Efsane
    achievements: List[str] = []  # List of achievement IDs
    streak_record: int = 0
    total_completions: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True

class Achievement(BaseModel):
    id: str
    name: str
    description: str
    icon: str
    requirement_type: str  # streak, completions, focus_score, level
    requirement_value: int
    unlocked: bool = False

# ==================== HELPER FUNCTIONS ====================

def calculate_focus_score(impact: int, difficulty: int, priority: str) -> float:
    """
    Priority Engine: Calculate focus score for habit sequencing
    Formula: (Impact * 1.5) - (Difficulty * 1.0) + (Priority Bonus)
    """
    priority_bonuses = {
        "urgent_important": 3.0,  # 🔥 Critical
        "important_not_urgent": 2.0,  # ⭐ High Priority  
        "urgent_not_important": 1.0,  # ⚡ Quick Win
        "neither": 0.0  # 📋 Later
    }
    
    base_score = (impact * 1.5) - (difficulty * 1.0)
    priority_bonus = priority_bonuses.get(priority, 0.0)
    focus_score = base_score + priority_bonus
    
    return round(focus_score, 2)

async def manage_habit_queue(user_id: str = "default"):
    """
    Automatically manage habit activation queue
    Max 3 active habits at a time
    """
    # Get all habits sorted by focus score
    all_habits = await db.habits.find({"is_active": True}).sort("focus_score", -1).to_list(100)
    
    active_habits = [h for h in all_habits if h.get("status") == "active"]
    queued_habits = [h for h in all_habits if h.get("status") == "queued"]
    
    # If less than 3 active, activate top queued habits
    if len(active_habits) < 3 and queued_habits:
        slots_available = 3 - len(active_habits)
        habits_to_activate = queued_habits[:slots_available]
        
        for habit in habits_to_activate:
            await db.habits.update_one(
                {"_id": habit["_id"]},
                {"$set": {"status": "active", "activated_at": datetime.utcnow()}}
            )

def calculate_habit_strength(completions_count: int, total_expected: int) -> float:
    """
    Loop-inspired algorithm: Progressive strength score
    - Each completion adds points
    - Missing days reduce points gradually
    """
    if total_expected == 0:
        return 0.0
    
    completion_rate = completions_count / total_expected
    strength = min(100.0, completion_rate * 100)
    return round(strength, 1)

async def trigger_webhooks(event_type: str, data: Dict[str, Any]):
    """
    Trigger all enabled webhooks for a specific event type
    """
    webhooks = await db.webhooks.find({"enabled": True, "event_types": event_type}).to_list(100)
    
    async with httpx.AsyncClient(timeout=5.0) as client:
        for webhook in webhooks:
            try:
                headers = webhook.get("headers", {})
                headers["Content-Type"] = "application/json"
                
                payload = {
                    "event": event_type,
                    "timestamp": datetime.utcnow().isoformat(),
                    "data": data
                }
                
                await client.post(webhook["url"], json=payload, headers=headers)
                logger.info(f"Webhook triggered: {webhook['url']} for {event_type}")
            except Exception as e:
                logger.error(f"Webhook failed: {webhook['url']} - {str(e)}")

# ==================== HABIT ENDPOINTS ====================

@api_router.post("/habits", response_model=Habit)
async def create_habit(habit: HabitCreate):
    # Calculate focus score
    focus_score = calculate_focus_score(habit.impact, habit.difficulty, habit.priority)
    
    # Check active habits count
    active_count = await db.habits.count_documents({"is_active": True, "status": "active"})
    
    # Determine initial status (max 3 active)
    initial_status = "active" if active_count < 3 else "queued"
    
    habit_dict = habit.dict()
    habit_dict["created_at"] = datetime.utcnow()
    habit_dict["strength_score"] = 0.0
    habit_dict["streak_current"] = 0
    habit_dict["streak_best"] = 0
    habit_dict["is_active"] = True
    habit_dict["status"] = initial_status
    habit_dict["focus_score"] = focus_score
    habit_dict["activated_at"] = datetime.utcnow() if initial_status == "active" else None
    
    result = await db.habits.insert_one(habit_dict)
    habit_dict["_id"] = str(result.inserted_id)
    return Habit(**habit_dict)

@api_router.get("/habits", response_model=List[Habit])
async def get_habits(active_only: bool = True):
    query = {"is_active": True} if active_only else {}
    habits = await db.habits.find(query).to_list(100)
    return [Habit(**serialize_doc(h)) for h in habits]

@api_router.get("/habits/{habit_id}", response_model=Habit)
async def get_habit(habit_id: str):
    habit = await db.habits.find_one({"_id": ObjectId(habit_id)})
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    return Habit(**serialize_doc(habit))

@api_router.patch("/habits/{habit_id}")
async def update_habit(habit_id: str, updates: Dict[str, Any]):
    result = await db.habits.update_one(
        {"_id": ObjectId(habit_id)},
        {"$set": updates}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Habit not found")
    return {"status": "updated"}

@api_router.delete("/habits/{habit_id}")
async def delete_habit(habit_id: str):
    # Soft delete
    result = await db.habits.update_one(
        {"_id": ObjectId(habit_id)},
        {"$set": {"is_active": False}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Habit not found")
    
    # Manage queue after deletion
    await manage_habit_queue()
    
    return {"status": "deleted"}

# ==================== HABIT SEQUENCING ENDPOINTS ====================

@api_router.post("/habits/{habit_id}/activate")
async def activate_habit(habit_id: str):
    """
    Manually activate a queued habit (with validation)
    """
    habit = await db.habits.find_one({"_id": ObjectId(habit_id)})
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    
    # Check if already active
    if habit.get("status") == "active":
        return {"message": "Habit is already active", "status": "active"}
    
    # Check active count
    active_count = await db.habits.count_documents({"is_active": True, "status": "active"})
    
    if active_count >= 3:
        # Check if any active habit is ready to be retired (>= 80% strength)
        active_habits = await db.habits.find({
            "is_active": True,
            "status": "active",
            "strength_score": {"$gte": 80}
        }).to_list(10)
        
        if not active_habits:
            raise HTTPException(
                status_code=400,
                detail="Maximum 3 active habits. Complete one to 80% first, or pause one."
            )
        
        # Suggest retiring the strongest habit
        strongest = max(active_habits, key=lambda h: h["strength_score"])
        return {
            "status": "blocked",
            "message": f"'{strongest['name']}' is at {strongest['strength_score']}% strength. Consider moving it to queued.",
            "suggested_habit_id": str(strongest["_id"])
        }
    
    # Activate the habit
    await db.habits.update_one(
        {"_id": ObjectId(habit_id)},
        {"$set": {"status": "active", "activated_at": datetime.utcnow()}}
    )
    
    return {"status": "activated", "message": "Habit activated successfully"}

@api_router.post("/habits/{habit_id}/pause")
async def pause_habit(habit_id: str):
    """
    Move habit back to queue
    """
    result = await db.habits.update_one(
        {"_id": ObjectId(habit_id)},
        {"$set": {"status": "queued"}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Habit not found")
    
    # Try to activate next queued habit
    await manage_habit_queue()
    
    return {"status": "paused"}

@api_router.get("/habits/queue/status")
async def get_queue_status():
    """
    Get habit queue analysis
    """
    all_habits = await db.habits.find({"is_active": True}).sort("focus_score", -1).to_list(100)
    
    active_habits = [serialize_doc(h) for h in all_habits if h.get("status") == "active"]
    queued_habits = [serialize_doc(h) for h in all_habits if h.get("status") == "queued"]
    
    # Calculate willpower load
    active_difficulty = sum(h.get("difficulty", 0) for h in active_habits)
    
    return {
        "active_count": len(active_habits),
        "queued_count": len(queued_habits),
        "active_habits": active_habits,
        "queued_habits": queued_habits,
        "willpower_load": active_difficulty,
        "can_add_more": len(active_habits) < 3,
        "recommendation": "Focus on your active habits before adding more." if len(active_habits) >= 3 else "You can add up to {} more habits.".format(3 - len(active_habits))
    }

# ==================== COMPLETION ENDPOINTS ====================

@api_router.post("/completions", response_model=Completion)
async def create_completion(completion: CompletionCreate):
    # Verify habit exists
    habit = await db.habits.find_one({"_id": ObjectId(completion.habit_id)})
    if not habit:
        raise HTTPException(status_code=404, detail="Habit not found")
    
    # Create completion
    completion_dict = completion.dict()
    completion_dict["completed_at"] = datetime.utcnow()
    result = await db.completions.insert_one(completion_dict)
    completion_dict["_id"] = str(result.inserted_id)
    
    # Update habit strength and streak
    today = datetime.utcnow().date()
    days_since_created = (today - habit["created_at"].date()).days + 1
    
    completions_count = await db.completions.count_documents({"habit_id": completion.habit_id})
    new_strength = calculate_habit_strength(completions_count, days_since_created)
    
    # Calculate streak
    yesterday = today - timedelta(days=1)
    yesterday_completion = await db.completions.find_one({
        "habit_id": completion.habit_id,
        "completed_at": {
            "$gte": datetime.combine(yesterday, datetime.min.time()),
            "$lt": datetime.combine(today, datetime.min.time())
        }
    })
    
    new_streak = habit["streak_current"] + 1 if yesterday_completion else 1
    new_best_streak = max(habit["streak_best"], new_streak)
    
    await db.habits.update_one(
        {"_id": ObjectId(completion.habit_id)},
        {"$set": {
            "strength_score": new_strength,
            "streak_current": new_streak,
            "streak_best": new_best_streak
        }}
    )
    
    # Trigger webhooks
    await trigger_webhooks("habit_completed", {
        "habit_id": completion.habit_id,
        "habit_name": habit["name"],
        "strength_score": new_strength,
        "streak": new_streak
    })
    
    return Completion(**completion_dict)

@api_router.get("/completions")
async def get_completions(habit_id: Optional[str] = None, days: int = 365):
    query = {}
    if habit_id:
        query["habit_id"] = habit_id
    
    start_date = datetime.utcnow() - timedelta(days=days)
    query["completed_at"] = {"$gte": start_date}
    
    completions = await db.completions.find(query).sort("completed_at", -1).to_list(1000)
    return [serialize_doc(c) for c in completions]

@api_router.get("/completions/heatmap")
async def get_heatmap_data(habit_id: Optional[str] = None):
    """
    Returns heatmap data for the last 365 days
    Format: {"2024-01-15": 3, "2024-01-16": 5, ...}
    """
    query = {}
    if habit_id:
        query["habit_id"] = habit_id
    
    start_date = datetime.utcnow() - timedelta(days=365)
    query["completed_at"] = {"$gte": start_date}
    
    completions = await db.completions.find(query).to_list(10000)
    
    # Group by date
    heatmap = {}
    for comp in completions:
        date_key = comp["completed_at"].strftime("%Y-%m-%d")
        heatmap[date_key] = heatmap.get(date_key, 0) + 1
    
    return heatmap

# ==================== TASK ENDPOINTS ====================

@api_router.post("/tasks", response_model=Task)
async def create_task(task: TaskCreate):
    task_dict = task.dict()
    task_dict["created_at"] = datetime.utcnow()
    task_dict["completed"] = False
    
    result = await db.tasks.insert_one(task_dict)
    task_dict["_id"] = str(result.inserted_id)
    return Task(**task_dict)

@api_router.get("/tasks", response_model=List[Task])
async def get_tasks(date: Optional[str] = None, completed: Optional[bool] = None):
    query = {}
    
    if date:
        target_date = datetime.fromisoformat(date)
        query["due_date"] = {
            "$gte": datetime.combine(target_date.date(), datetime.min.time()),
            "$lt": datetime.combine(target_date.date(), datetime.max.time())
        }
    
    if completed is not None:
        query["completed"] = completed
    
    tasks = await db.tasks.find(query).sort("time_block_start", 1).to_list(100)
    return [Task(**serialize_doc(t)) for t in tasks]

@api_router.patch("/tasks/{task_id}")
async def update_task(task_id: str, updates: Dict[str, Any]):
    # If marking as completed, set completed_at
    if updates.get("completed") is True:
        updates["completed_at"] = datetime.utcnow()
        
        # Get task details for webhook
        task = await db.tasks.find_one({"_id": ObjectId(task_id)})
        if task:
            await trigger_webhooks("task_completed", {
                "task_id": task_id,
                "task_title": task["title"]
            })
    
    result = await db.tasks.update_one(
        {"_id": ObjectId(task_id)},
        {"$set": updates}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "updated"}

@api_router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    result = await db.tasks.delete_one({"_id": ObjectId(task_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "deleted"}

@api_router.post("/tasks/{task_id}/split")
async def split_task_adhd(task_id: str, chunk_minutes: int = 25):
    """
    ADHD Mode: Split a large task into smaller subtasks
    """
    task = await db.tasks.find_one({"_id": ObjectId(task_id)})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Simple rule-based splitting
    subtasks = []
    task_title = task["title"]
    
    # Create 3 subtasks for now (can be enhanced)
    subtask_titles = [
        f"🎯 Start: {task_title} (5 min)",
        f"⚡ Work on: {task_title} ({chunk_minutes} min)",
        f"✅ Finish: {task_title} (5 min)"
    ]
    
    for i, title in enumerate(subtask_titles):
        subtask_dict = {
            "title": title,
            "description": f"Part {i+1} of {task_title}",
            "category": task.get("category", "general"),
            "due_date": task.get("due_date"),
            "is_subtask": True,
            "parent_task_id": task_id,
            "completed": False,
            "created_at": datetime.utcnow()
        }
        result = await db.tasks.insert_one(subtask_dict)
        subtask_dict["_id"] = str(result.inserted_id)
        subtasks.append(Task(**subtask_dict))
    
    return {"subtasks": subtasks}

# ==================== WEBHOOK ENDPOINTS ====================

@api_router.post("/webhooks", response_model=Webhook)
async def create_webhook(webhook: WebhookCreate):
    webhook_dict = webhook.dict()
    webhook_dict["created_at"] = datetime.utcnow()
    webhook_dict["enabled"] = True
    
    result = await db.webhooks.insert_one(webhook_dict)
    webhook_dict["_id"] = str(result.inserted_id)
    return Webhook(**webhook_dict)

@api_router.get("/webhooks", response_model=List[Webhook])
async def get_webhooks():
    webhooks = await db.webhooks.find().to_list(100)
    return [Webhook(**serialize_doc(w)) for w in webhooks]

@api_router.delete("/webhooks/{webhook_id}")
async def delete_webhook(webhook_id: str):
    result = await db.webhooks.delete_one({"_id": ObjectId(webhook_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"status": "deleted"}

# ==================== BAD HABIT ENDPOINTS ====================

@api_router.post("/bad-habits", response_model=BadHabit)
async def create_bad_habit(bad_habit: BadHabitCreate):
    habit_dict = bad_habit.dict()
    habit_dict["created_at"] = datetime.utcnow()
    
    result = await db.bad_habits.insert_one(habit_dict)
    habit_dict["_id"] = str(result.inserted_id)
    return BadHabit(**habit_dict)

@api_router.get("/bad-habits", response_model=List[BadHabit])
async def get_bad_habits():
    habits = await db.bad_habits.find().to_list(100)
    return [BadHabit(**serialize_doc(h)) for h in habits]

@api_router.get("/bad-habits/{habit_id}/savings")
async def get_bad_habit_savings(habit_id: str):
    habit = await db.bad_habits.find_one({"_id": ObjectId(habit_id)})
    if not habit:
        raise HTTPException(status_code=404, detail="Bad habit not found")
    
    days_since_quit = (datetime.utcnow() - habit["quit_date"]).days
    money_saved = days_since_quit * habit["cost_per_day"]
    time_saved = days_since_quit * habit["time_wasted_per_day"]  # in minutes
    
    return {
        "days_since_quit": days_since_quit,
        "money_saved": round(money_saved, 2),
        "time_saved_minutes": time_saved,
        "time_saved_hours": round(time_saved / 60, 1)
    }

# ==================== EXPORT ENDPOINT ====================

@api_router.get("/export")
async def export_all_data():
    """
    Export all user data in JSON format for backup
    """
    habits = await db.habits.find().to_list(1000)
    tasks = await db.tasks.find().to_list(1000)
    completions = await db.completions.find().to_list(10000)
    bad_habits = await db.bad_habits.find().to_list(100)
    webhooks = await db.webhooks.find().to_list(100)
    
    return {
        "export_date": datetime.utcnow().isoformat(),
        "habits": [serialize_doc(h) for h in habits],
        "tasks": [serialize_doc(t) for t in tasks],
        "completions": [serialize_doc(c) for c in completions],
        "bad_habits": [serialize_doc(b) for b in bad_habits],
        "webhooks": [serialize_doc(w) for w in webhooks]
    }

# ==================== DATA EXPORT ENDPOINTS ====================

@api_router.get("/data/export/excel")
async def export_excel():
    """
    Export all data to Excel format with flat table structure
    """
    try:
        # Fetch all data
        habits = await db.habits.find({"is_active": True}).to_list(1000)
        completions = await db.completions.find().to_list(10000)
        
        # Create flat table
        rows = []
        for completion in completions:
            # Find related habit
            habit = next((h for h in habits if str(h["_id"]) == completion["habit_id"]), None)
            if not habit:
                continue
            
            # Calculate willpower load at that time (simplified - just the habit's difficulty)
            row = {
                "Tarih": completion["completed_at"].strftime("%Y-%m-%d"),
                "Aliskanlik_Adi": habit.get("name", ""),
                "Kategori": habit.get("category", ""),
                "Focus_Score": habit.get("focus_score", 0),
                "Zorluk_Derecesi": habit.get("difficulty", 0),
                "Etki_Seviyesi": habit.get("impact", 0),
                "Irade_Yuku": habit.get("difficulty", 0),
                "Tamamlanma_Durumu": 1,
                "XP_Kazanilan": habit.get("strength_score", 0),
            }
            rows.append(row)
        
        # Create DataFrame
        df = pd.DataFrame(rows)
        
        # Sort by date
        if not df.empty:
            df = df.sort_values("Tarih")
        
        # Create Excel file in memory
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, sheet_name='CoreHabit_Data', index=False)
        
        output.seek(0)
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f"attachment; filename=corehabit_data_{datetime.utcnow().strftime('%Y%m%d')}.xlsx"
            }
        )
    except Exception as e:
        logger.error(f"Excel export error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

@api_router.get("/data/export/csv")
async def export_csv():
    """
    Export all data to CSV format with flat table structure
    """
    try:
        # Fetch all data
        habits = await db.habits.find({"is_active": True}).to_list(1000)
        completions = await db.completions.find().to_list(10000)
        
        # Create flat table
        rows = []
        for completion in completions:
            # Find related habit
            habit = next((h for h in habits if str(h["_id"]) == completion["habit_id"]), None)
            if not habit:
                continue
            
            row = {
                "Tarih": completion["completed_at"].strftime("%Y-%m-%d"),
                "Aliskanlik_Adi": habit.get("name", ""),
                "Kategori": habit.get("category", ""),
                "Focus_Score": habit.get("focus_score", 0),
                "Zorluk_Derecesi": habit.get("difficulty", 0),
                "Etki_Seviyesi": habit.get("impact", 0),
                "Irade_Yuku": habit.get("difficulty", 0),
                "Tamamlanma_Durumu": 1,
                "XP_Kazanilan": habit.get("strength_score", 0),
            }
            rows.append(row)
        
        # Create DataFrame
        df = pd.DataFrame(rows)
        
        # Sort by date
        if not df.empty:
            df = df.sort_values("Tarih")
        
        # Create CSV in memory with UTF-8 BOM for Excel compatibility
        output = BytesIO()
        df.to_csv(output, index=False, encoding='utf-8-sig')
        output.seek(0)
        
        return StreamingResponse(
            output,
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=corehabit_data_{datetime.utcnow().strftime('%Y%m%d')}.csv"
            }
        )
    except Exception as e:
        logger.error(f"CSV export error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

# ==================== STATS ENDPOINT ====================

@api_router.get("/stats")
async def get_stats():
    total_habits = await db.habits.count_documents({"is_active": True})
    total_tasks = await db.tasks.count_documents({"completed": False})
    completed_tasks = await db.tasks.count_documents({"completed": True})
    total_completions = await db.completions.count_documents({})
    
    # Get today's completions
    today_start = datetime.combine(datetime.utcnow().date(), datetime.min.time())
    today_completions = await db.completions.count_documents({
        "completed_at": {"$gte": today_start}
    })
    
    return {
        "total_habits": total_habits,
        "active_tasks": total_tasks,
        "completed_tasks": completed_tasks,
        "total_completions": total_completions,
        "today_completions": today_completions
    }

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
