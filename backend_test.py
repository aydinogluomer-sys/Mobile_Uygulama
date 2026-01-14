#!/usr/bin/env python3
"""
CoreHabit Backend API Test Suite
Tests all backend endpoints for the habit tracking application
"""

import requests
import json
from datetime import datetime, timedelta
import time
import sys

# Base URL from frontend .env
BASE_URL = "https://datawizard-track.preview.emergentagent.com/api"

class CoreHabitTester:
    def __init__(self):
        self.base_url = BASE_URL
        self.session = requests.Session()
        self.test_data = {}
        self.webhook_url = None
        self.results = {
            "passed": 0,
            "failed": 0,
            "errors": []
        }
    
    def log_result(self, test_name, success, message=""):
        if success:
            self.results["passed"] += 1
            print(f"✅ {test_name}: PASSED {message}")
        else:
            self.results["failed"] += 1
            self.results["errors"].append(f"{test_name}: {message}")
            print(f"❌ {test_name}: FAILED - {message}")
    
    def make_request(self, method, endpoint, **kwargs):
        """Make HTTP request with error handling"""
        url = f"{self.base_url}{endpoint}"
        try:
            response = self.session.request(method, url, **kwargs)
            return response
        except Exception as e:
            print(f"Request error for {method} {endpoint}: {str(e)}")
            return None
    
    def test_habits_crud(self):
        """Test Habits CRUD operations"""
        print("\n🧪 Testing Habits CRUD Operations...")
        
        # 1. Create habit
        habit_data = {
            "name": "Morning Exercise",
            "description": "30 minutes of cardio exercise",
            "category": "health",
            "frequency": "daily",
            "target_days": [0, 1, 2, 3, 4, 5, 6],
            "color": "#10b981",
            "icon": "🏃"
        }
        
        response = self.make_request("POST", "/habits", json=habit_data)
        if response and response.status_code == 200:
            habit = response.json()
            self.test_data["habit_id"] = habit["_id"]
            self.log_result("Create Habit", True, f"Created habit with ID: {habit['_id']}")
        else:
            self.log_result("Create Habit", False, f"Status: {response.status_code if response else 'No response'}")
            return
        
        # 2. Get all habits
        response = self.make_request("GET", "/habits")
        if response and response.status_code == 200:
            habits = response.json()
            self.log_result("Get All Habits", len(habits) > 0, f"Retrieved {len(habits)} habits")
        else:
            self.log_result("Get All Habits", False, f"Status: {response.status_code if response else 'No response'}")
        
        # 3. Get specific habit
        if "habit_id" in self.test_data:
            response = self.make_request("GET", f"/habits/{self.test_data['habit_id']}")
            if response and response.status_code == 200:
                habit = response.json()
                self.log_result("Get Specific Habit", habit["name"] == "Morning Exercise", "Retrieved correct habit")
            else:
                self.log_result("Get Specific Habit", False, f"Status: {response.status_code if response else 'No response'}")
        
        # 4. Update habit
        if "habit_id" in self.test_data:
            update_data = {"description": "Updated: 45 minutes of cardio exercise"}
            response = self.make_request("PATCH", f"/habits/{self.test_data['habit_id']}", json=update_data)
            if response and response.status_code == 200:
                self.log_result("Update Habit", True, "Habit updated successfully")
            else:
                self.log_result("Update Habit", False, f"Status: {response.status_code if response else 'No response'}")
    
    def test_completions(self):
        """Test Completions and habit strength calculation"""
        print("\n🧪 Testing Completions and Strength Calculation...")
        
        if "habit_id" not in self.test_data:
            self.log_result("Completions Test", False, "No habit ID available for testing")
            return
        
        # 1. Create completion
        completion_data = {
            "habit_id": self.test_data["habit_id"],
            "notes": "Great workout session!",
            "mood": 5
        }
        
        response = self.make_request("POST", "/completions", json=completion_data)
        if response and response.status_code == 200:
            completion = response.json()
            self.test_data["completion_id"] = completion["_id"]
            self.log_result("Create Completion", True, f"Created completion with ID: {completion['_id']}")
        else:
            self.log_result("Create Completion", False, f"Status: {response.status_code if response else 'No response'}")
            return
        
        # 2. Verify strength score calculation
        response = self.make_request("GET", f"/habits/{self.test_data['habit_id']}")
        if response and response.status_code == 200:
            habit = response.json()
            strength_score = habit.get("strength_score", 0)
            self.log_result("Strength Score Calculation", strength_score > 0, f"Strength score: {strength_score}")
        else:
            self.log_result("Strength Score Calculation", False, "Could not retrieve updated habit")
        
        # 3. Get completions
        response = self.make_request("GET", "/completions", params={"habit_id": self.test_data["habit_id"]})
        if response and response.status_code == 200:
            completions = response.json()
            self.log_result("Get Completions", len(completions) > 0, f"Retrieved {len(completions)} completions")
        else:
            self.log_result("Get Completions", False, f"Status: {response.status_code if response else 'No response'}")
    
    def test_tasks(self):
        """Test Task management"""
        print("\n🧪 Testing Task Management...")
        
        # 1. Create task
        task_data = {
            "title": "Complete project proposal",
            "description": "Write and review the Q1 project proposal",
            "category": "work",
            "due_date": (datetime.utcnow() + timedelta(days=1)).isoformat(),
            "time_block_start": "14:00",
            "time_block_end": "16:00"
        }
        
        response = self.make_request("POST", "/tasks", json=task_data)
        if response and response.status_code == 200:
            task = response.json()
            self.test_data["task_id"] = task["_id"]
            self.log_result("Create Task", True, f"Created task with ID: {task['_id']}")
        else:
            self.log_result("Create Task", False, f"Status: {response.status_code if response else 'No response'}")
            return
        
        # 2. Get tasks by date
        today = datetime.utcnow().isoformat()
        response = self.make_request("GET", "/tasks", params={"date": today})
        if response and response.status_code == 200:
            tasks = response.json()
            self.log_result("Get Tasks by Date", True, f"Retrieved {len(tasks)} tasks for today")
        else:
            self.log_result("Get Tasks by Date", False, f"Status: {response.status_code if response else 'No response'}")
        
        # 3. Mark task as complete
        if "task_id" in self.test_data:
            update_data = {"completed": True}
            response = self.make_request("PATCH", f"/tasks/{self.test_data['task_id']}", json=update_data)
            if response and response.status_code == 200:
                self.log_result("Mark Task Complete", True, "Task marked as completed")
            else:
                self.log_result("Mark Task Complete", False, f"Status: {response.status_code if response else 'No response'}")
        
        # 4. Split task (ADHD mode)
        if "task_id" in self.test_data:
            response = self.make_request("POST", f"/tasks/{self.test_data['task_id']}/split", json={"chunk_minutes": 25})
            if response and response.status_code == 200:
                result = response.json()
                subtasks = result.get("subtasks", [])
                self.log_result("Split Task (ADHD Mode)", len(subtasks) > 0, f"Created {len(subtasks)} subtasks")
            else:
                self.log_result("Split Task (ADHD Mode)", False, f"Status: {response.status_code if response else 'No response'}")
    
    def test_webhooks(self):
        """Test Webhook functionality"""
        print("\n🧪 Testing Webhook Functionality...")
        
        # Get a test webhook URL from webhook.site
        print("📡 Getting test webhook URL from webhook.site...")
        try:
            webhook_response = requests.get("https://webhook.site/token", timeout=10)
            if webhook_response.status_code == 200:
                token_data = webhook_response.json()
                self.webhook_url = f"https://webhook.site/{token_data['uuid']}"
                print(f"🔗 Test webhook URL: {self.webhook_url}")
            else:
                # Fallback to a static webhook URL
                self.webhook_url = "https://webhook.site/unique-id-test"
                print(f"🔗 Using fallback webhook URL: {self.webhook_url}")
        except Exception as e:
            self.webhook_url = "https://webhook.site/unique-id-test"
            print(f"⚠️ Could not get webhook.site URL, using fallback: {self.webhook_url}")
        
        # 1. Create webhook
        webhook_data = {
            "url": self.webhook_url,
            "event_types": ["habit_completed", "task_completed"],
            "headers": {"X-Test-Header": "CoreHabit-Test"}
        }
        
        response = self.make_request("POST", "/webhooks", json=webhook_data)
        if response and response.status_code == 200:
            webhook = response.json()
            self.test_data["webhook_id"] = webhook["_id"]
            self.log_result("Create Webhook", True, f"Created webhook with ID: {webhook['_id']}")
        else:
            self.log_result("Create Webhook", False, f"Status: {response.status_code if response else 'No response'}")
            return
        
        # 2. Get webhooks
        response = self.make_request("GET", "/webhooks")
        if response and response.status_code == 200:
            webhooks = response.json()
            self.log_result("Get Webhooks", len(webhooks) > 0, f"Retrieved {len(webhooks)} webhooks")
        else:
            self.log_result("Get Webhooks", False, f"Status: {response.status_code if response else 'No response'}")
        
        # 3. Test webhook trigger by completing a habit
        if "habit_id" in self.test_data:
            print("🔔 Triggering webhook by completing a habit...")
            completion_data = {
                "habit_id": self.test_data["habit_id"],
                "notes": "Testing webhook trigger",
                "mood": 4
            }
            
            response = self.make_request("POST", "/completions", json=completion_data)
            if response and response.status_code == 200:
                self.log_result("Webhook Trigger Test", True, "Habit completion should trigger webhook")
                print("   Note: Check webhook.site to verify webhook was received")
            else:
                self.log_result("Webhook Trigger Test", False, "Failed to complete habit for webhook test")
    
    def test_bad_habits(self):
        """Test Bad Habits tracking and savings calculation"""
        print("\n🧪 Testing Bad Habits and Savings Calculation...")
        
        # 1. Create bad habit
        quit_date = datetime.utcnow() - timedelta(days=30)  # Quit 30 days ago
        bad_habit_data = {
            "name": "Smoking",
            "description": "Cigarette smoking habit",
            "quit_date": quit_date.isoformat(),
            "cost_per_day": 15.0,  # $15 per day
            "time_wasted_per_day": 60  # 60 minutes per day
        }
        
        response = self.make_request("POST", "/bad-habits", json=bad_habit_data)
        if response and response.status_code == 200:
            bad_habit = response.json()
            self.test_data["bad_habit_id"] = bad_habit["_id"]
            self.log_result("Create Bad Habit", True, f"Created bad habit with ID: {bad_habit['_id']}")
        else:
            self.log_result("Create Bad Habit", False, f"Status: {response.status_code if response else 'No response'}")
            return
        
        # 2. Get bad habits
        response = self.make_request("GET", "/bad-habits")
        if response and response.status_code == 200:
            bad_habits = response.json()
            self.log_result("Get Bad Habits", len(bad_habits) > 0, f"Retrieved {len(bad_habits)} bad habits")
        else:
            self.log_result("Get Bad Habits", False, f"Status: {response.status_code if response else 'No response'}")
        
        # 3. Get savings calculation
        if "bad_habit_id" in self.test_data:
            response = self.make_request("GET", f"/bad-habits/{self.test_data['bad_habit_id']}/savings")
            if response and response.status_code == 200:
                savings = response.json()
                money_saved = savings.get("money_saved", 0)
                time_saved = savings.get("time_saved_hours", 0)
                days_quit = savings.get("days_since_quit", 0)
                
                # Verify calculations (approximately 30 days * $15 = $450)
                expected_money = 30 * 15.0
                calculation_correct = abs(money_saved - expected_money) < 50  # Allow some variance
                
                self.log_result("Savings Calculation", calculation_correct, 
                              f"Days quit: {days_quit}, Money saved: ${money_saved}, Time saved: {time_saved}h")
            else:
                self.log_result("Savings Calculation", False, f"Status: {response.status_code if response else 'No response'}")
    
    def test_export(self):
        """Test Export functionality"""
        print("\n🧪 Testing Export Functionality...")
        
        response = self.make_request("GET", "/export")
        if response and response.status_code == 200:
            export_data = response.json()
            
            # Check if all expected data types are present
            expected_keys = ["habits", "tasks", "completions", "bad_habits", "webhooks", "export_date"]
            has_all_keys = all(key in export_data for key in expected_keys)
            
            self.log_result("Export All Data", has_all_keys, 
                          f"Export contains: {', '.join(export_data.keys())}")
        else:
            self.log_result("Export All Data", False, f"Status: {response.status_code if response else 'No response'}")
    
    def test_stats(self):
        """Test Stats endpoint"""
        print("\n🧪 Testing Stats Endpoint...")
        
        response = self.make_request("GET", "/stats")
        if response and response.status_code == 200:
            stats = response.json()
            
            # Check if all expected stats are present
            expected_keys = ["total_habits", "active_tasks", "completed_tasks", "total_completions", "today_completions"]
            has_all_keys = all(key in stats for key in expected_keys)
            
            self.log_result("Get Stats", has_all_keys, 
                          f"Stats: {stats.get('total_habits', 0)} habits, {stats.get('total_completions', 0)} completions")
        else:
            self.log_result("Get Stats", False, f"Status: {response.status_code if response else 'No response'}")
    
    def test_heatmap(self):
        """Test Heatmap data generation"""
        print("\n🧪 Testing Heatmap Data Generation...")
        
        # 1. Get overall heatmap
        response = self.make_request("GET", "/completions/heatmap")
        if response and response.status_code == 200:
            heatmap_data = response.json()
            self.log_result("Get Heatmap Data", isinstance(heatmap_data, dict), 
                          f"Heatmap contains {len(heatmap_data)} date entries")
        else:
            self.log_result("Get Heatmap Data", False, f"Status: {response.status_code if response else 'No response'}")
        
        # 2. Get heatmap for specific habit
        if "habit_id" in self.test_data:
            response = self.make_request("GET", "/completions/heatmap", params={"habit_id": self.test_data["habit_id"]})
            if response and response.status_code == 200:
                heatmap_data = response.json()
                self.log_result("Get Habit-Specific Heatmap", isinstance(heatmap_data, dict), 
                              f"Habit heatmap contains {len(heatmap_data)} date entries")
            else:
                self.log_result("Get Habit-Specific Heatmap", False, f"Status: {response.status_code if response else 'No response'}")
    
    def cleanup(self):
        """Clean up test data"""
        print("\n🧹 Cleaning up test data...")
        
        # Delete created webhook
        if "webhook_id" in self.test_data:
            response = self.make_request("DELETE", f"/webhooks/{self.test_data['webhook_id']}")
            if response and response.status_code == 200:
                print("✅ Webhook deleted")
            else:
                print("⚠️ Could not delete webhook")
        
        # Soft delete habit (mark as inactive)
        if "habit_id" in self.test_data:
            response = self.make_request("DELETE", f"/habits/{self.test_data['habit_id']}")
            if response and response.status_code == 200:
                print("✅ Habit deleted (soft delete)")
            else:
                print("⚠️ Could not delete habit")
        
        # Delete task
        if "task_id" in self.test_data:
            response = self.make_request("DELETE", f"/tasks/{self.test_data['task_id']}")
            if response and response.status_code == 200:
                print("✅ Task deleted")
            else:
                print("⚠️ Could not delete task")
    
    def run_all_tests(self):
        """Run all test suites"""
        print("🚀 Starting CoreHabit Backend API Tests")
        print(f"🌐 Base URL: {self.base_url}")
        print("=" * 60)
        
        try:
            # Test basic connectivity
            response = self.make_request("GET", "/stats")
            if not response or response.status_code != 200:
                print("❌ Cannot connect to backend API")
                print("🔍 Check if backend service is running")
                return
            
            print("✅ Backend API is accessible")
            
            # Run all test suites
            self.test_habits_crud()
            self.test_completions()
            self.test_tasks()
            self.test_webhooks()
            self.test_bad_habits()
            self.test_export()
            self.test_stats()
            self.test_heatmap()
            
            # Cleanup
            self.cleanup()
            
        except Exception as e:
            print(f"❌ Test execution error: {str(e)}")
            self.results["errors"].append(f"Test execution error: {str(e)}")
        
        # Print summary
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        print(f"✅ Passed: {self.results['passed']}")
        print(f"❌ Failed: {self.results['failed']}")
        
        if self.results["errors"]:
            print("\n🚨 FAILED TESTS:")
            for error in self.results["errors"]:
                print(f"   • {error}")
        
        success_rate = (self.results["passed"] / (self.results["passed"] + self.results["failed"])) * 100 if (self.results["passed"] + self.results["failed"]) > 0 else 0
        print(f"\n📈 Success Rate: {success_rate:.1f}%")
        
        return self.results

if __name__ == "__main__":
    tester = CoreHabitTester()
    results = tester.run_all_tests()
    
    # Exit with error code if tests failed
    if results["failed"] > 0:
        sys.exit(1)
    else:
        sys.exit(0)