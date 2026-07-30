from pydantic import BaseModel
from typing import Optional, List

class SubjectCreate(BaseModel):
    name: str
    category: str = ""
    type_tag: str = "問題"
    problems: List[dict]
    deadline: Optional[str] = None

class SubjectUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    type_tag: Optional[str] = None
    deadline: Optional[str] = None
    is_paused: Optional[int] = None

class RecordUpdate(BaseModel):
    result: Optional[str] = None

class GoalUpdate(BaseModel):
    goal: int

class ProblemStatusUpdate(BaseModel):
    status: int
    pass1_date: Optional[str] = None
    pass2_date: Optional[str] = None

class SRSReview(BaseModel):
    problem_id: int
    rating: int

class ProblemsAdd(BaseModel):
    problems: List[dict]
