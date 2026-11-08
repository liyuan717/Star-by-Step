insert into private.economy_rules values(1,true,300,100,3000,9000000000000) on conflict do nothing;
insert into public.world_levels(level,min_xp) values(1,0),(2,100),(3,300),(4,700),(5,1500),(6,3000),(7,5500),(8,9000),(9,14000),(10,20000) on conflict do nothing;
insert into public.building_levels(building_key,level,min_xp,min_study_minutes,min_life_count,min_exercise_count,asset_key,grid_i,grid_j) values
('base',1,0,0,0,0,'base_1',0,0),('base',2,300,0,0,0,'base_2',0,0),('base',3,1500,0,0,0,'base_3',0,0),
('energy_hub',1,100,0,0,0,'energy_hub_1',2,0),('energy_hub',2,700,0,0,0,'energy_hub_2',2,0),('energy_hub',3,3000,0,0,0,'energy_hub_3',2,0),
('research_lab',1,300,300,0,0,'research_lab_1',0,2),('research_lab',2,1500,600,0,0,'research_lab_2',0,2),('research_lab',3,5500,1800,0,0,'research_lab_3',0,2),
('greenhouse',1,700,0,10,0,'greenhouse_1',-2,1),('greenhouse',2,3000,0,30,0,'greenhouse_2',-2,1),('greenhouse',3,9000,0,60,0,'greenhouse_3',-2,1),
('training_pod',1,1500,0,0,10,'training_pod_1',2,2),('training_pod',2,5500,0,0,30,'training_pod_2',2,2),('training_pod',3,14000,0,0,60,'training_pod_3',2,2) on conflict do nothing;
insert into public.virtual_catalog(key,title,description,energy_cost,slot,asset_key) values
('beacon','星光信标','为起源星点亮一束蓝光',100,'beacon','beacon'),('garden','月光花园','安静生长的月光植物',200,'garden','garden'),('sky','极光天幕','横跨殖民地的柔和极光',300,'sky','sky') on conflict do nothing;
insert into public.achievements values
('first_task','首次完成','完成第一次行动','count',1,'first_task',true),('ten_tasks','持续行动','累计完成十次','count',10,'ten_tasks',true),
('scholar','知识探索者','累计学习300分钟','study',300,'scholar',true),('seven_days','七日同行','连续七个本地日行动','streak',7,'seven_days',true),('first_reward','首次兑换','兑换一份奖励','redemptions',1,'first_reward',true) on conflict do nothing;
