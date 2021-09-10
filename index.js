const bodyParser = require('body-parser')
const express = require('express')

const PORT = process.env.PORT || 3000

const app = express()
app.use(bodyParser.json())

app.get('/', handleIndex)
app.post('/start', handleStart)
app.post('/move', handleMove)
app.post('/end', handleEnd)

app.listen(PORT, () => console.log(`Battlesnake Server listening at http://127.0.0.1:${PORT}`))

let boardHeight;
let boardWidth;

const STATE_DEFAULT = 0;
const STATE_TARGETFOOD = 1;
const STATE_ATTACK = 2;
const STATE_STARVING = 3;

const BOARD_EMPTY = 0;
const BOARD_ENEMYHEAD = 1;
const BOARD_BODIES = 2;

const CALCULATE_SCORE_ITERATION = 5;
const HEALTH_TO_START_STARVE_STATE = 10;

const DISTANCE_TO_SCAN_ENEMY_ATTACK = 10;

const MIN_FOOD_TARGET_FRAC_FROM_HIGHEST_SCORE_TARGETFOOD = 0.6;
const MIN_FOOD_TARGET_FRAC_FROM_HIGHEST_SCORE_STARVE = 0.1;

const MIN_ENEMY_ATTACK_FRAC_FROM_HIGHEST_SCORE = 0.6;
const DISTANCE_TO_SCAN_FOR_FOOD_ON_DEFAULT = 10;

function handleIndex(request, response) {
  var battlesnakeInfo = {
    apiversion: '1',
    author: 'Randy',
    color: '#228ca3',
    head: 'shac-caffeine',
    tail: 'bwc-flake'
  }
  response.status(200).json(battlesnakeInfo)
}

function handleStart(request, response) {
  let gameData = request.body;

  boardHeight = gameData.board.height;
  boardWidth = gameData.board.width;

  console.log('START')
  response.status(200).send('ok')
}

function handleMove(request, response) {

  let gameData = request.body;
  let boardMap = GetBoardMap(gameData);

  console.log("--TURN: " + gameData.turn + "--")
  
  //Get movement state
  let currentState = GetMoveState(gameData);

  //Actual movement
  {

    let move = null;

    switch (currentState.id) {
      case (STATE_DEFAULT):
        {
          console.log("DEFAULT " + "HEALTH: " + gameData.you.health);
          move = GetBestMoveDefault(gameData, boardMap);
          break;
        }
      case (STATE_TARGETFOOD):
        {
          move = GetBestMoveTargetFood(gameData, boardMap, currentState.closestFoodPosition, MIN_FOOD_TARGET_FRAC_FROM_HIGHEST_SCORE_TARGETFOOD);
          break;
        }
      case (STATE_ATTACK):
        {
          move = GetBestMoveAttack(gameData, boardMap, currentState.enemySnake)
          break;          
        }
      case (STATE_STARVING):
        {
          console.log("STARVING");
          move = GetBestMoveTargetFood(gameData, boardMap, currentState.closestFoodPosition, MIN_FOOD_TARGET_FRAC_FROM_HIGHEST_SCORE_STARVE);
          break;  
        }
    }
    //console.log('MOVE: ' + move)
    response.status(200).send({
      move: move
    })
  }

  function GetBoardMap(gameData) {
    
    let boardMap = [];

    //Initialize board map
    {
      for (let i = 0; i < boardHeight; i++) {
        let row = [];
        for (let j = 0; j < boardWidth; j++) {
          row.push( { type: BOARD_EMPTY });
        }
        boardMap.push(row);
      }

    }
    //Get self bodies
    {
      let snakeBodyPositions = gameData.you.body;
      for (let i = 0; i < snakeBodyPositions.length-1; i++) {
        let thisBodyPosition = snakeBodyPositions[i];
        boardMap[thisBodyPosition.x][thisBodyPosition.y] = { type: BOARD_BODIES };
      }
    }

    //Get enemy bodies and heads
    {
      let otherSnakes = gameData.board.snakes;

      otherSnakes.forEach(function(snake) {

        if (snake.id.localeCompare(gameData.you.id) == 0)
          return;

        let snakeBodyPositions = snake.body;
        for (let i = 0; i < snakeBodyPositions.length-1; i++) {
          let thisBodyPosition = snakeBodyPositions[i];
          boardMap[thisBodyPosition.x][thisBodyPosition.y] = { type: BOARD_BODIES };
        }
        let snakeHeadPosition = snake.head;
        boardMap[snakeHeadPosition.x][snakeHeadPosition.y] = { type: BOARD_ENEMYHEAD, snakeLength: snake.length };
      })
    }

    return boardMap;
  }
}

function GetPossibleMoves(gameData, position, boardMap) {
  let possibleMoves = ['up', 'down', 'left', 'right']; 

  //Eliminate invalid moves
  {
    let adjacentPositions = GetAdjacentPositions(position);

    adjacentPositions.forEach(function(adjacentPosition) {  
      let boardInfo = GetBoardInfo(boardMap, adjacentPosition);
      if (boardInfo == null || boardInfo.type != BOARD_EMPTY) {
        const index = possibleMoves.indexOf(adjacentPosition.direction);
        if (index > -1)
          possibleMoves.splice(index, 1);
      }
    })

    {
      //Avoid possible enemy head collisions if they are longer
      let possibleMovesClone = Array.from(possibleMoves);

      if (possibleMoves.length > 1) {
        adjacentPositions.forEach(function(adjacentPosition) {  

          let adjacentOfAdjacentPositions = GetAdjacentPositions(adjacentPosition);

          adjacentOfAdjacentPositions.forEach(function(adjacentOfAdjacentPosition) {
            let boardInfo = GetBoardInfo(boardMap, adjacentOfAdjacentPosition);

            if (boardInfo != null && boardInfo.type == BOARD_ENEMYHEAD) {

              //Not a possible move if there is a longer snake in range
              if (boardInfo.snakeLength >= gameData.you.length) {

                const index = possibleMoves.indexOf(adjacentPosition.direction);
                if (index > -1) {
                  possibleMoves.splice(index, 1);                
                }
              }
            }
          })
        })

        //If no possible moves after checking for enemy, go back to old possible moves
        if (possibleMoves.length == 0) {
          possibleMoves = possibleMovesClone;
        }
      }
    }
  }

  return possibleMoves;
}

function GetAdjacentPositions(position) {
  let adjacentPositions =
  [
    {
      direction: "right",
      x: position.x + 1,
      y: position.y
    },
    {
      direction: "left",
      x: position.x - 1,
      y: position.y
    },
    {
      direction: "up",
      x: position.x,
      y: position.y + 1
    },
    {
      direction: "down",
      x: position.x,
      y: position.y - 1
    }
  ]
  return adjacentPositions;
}

function GetBestMoveAttack(gameData, boardMap, enemySnake) {

  let possibleMoves = GetPossibleMoves(gameData, gameData.you.head, boardMap); //Array consisting of [left, right, up, down] 

  let headPosition = gameData.you.head;

  let attackDesiredMoves = [];
  {
    if (headPosition.x > enemySnake.head.x)
      attackDesiredMoves.push('left')
    else if (headPosition.x < enemySnake.head.x)
      attackDesiredMoves.push('right')

    if (headPosition.y > enemySnake.head.y)
      attackDesiredMoves.push('down')
    else if (headPosition.y < enemySnake.head.y)
      attackDesiredMoves.push('up')
  }

  let directionsToScores = GetDirectionsToScores(gameData, boardMap);
  let highestScoreDirection = directionsToScores["highestScoreDirection"];

  let distanceToEnemy = GetDistance(headPosition, enemySnake.head);

  //If range is 1, can't attack, just go to highestScore direction
  if (distanceToEnemy == 1) {
    console.log("ATTACK: " + "TOO CLOSE CANT ATTACK");
    return highestScoreDirection.direction;
  }
  //If range is 2 and movable, ATTACK! 
  //(Could still not be movable if there is a snake body between heads so we need to check for that)
  else if (distanceToEnemy == 2) {

    let bestAttackDirection = null;
    let bestAttackDirectionScore = -1;

    attackDesiredMoves.forEach(function(attackDir) {
      let directionScore = directionsToScores[attackDir];
      if (directionScore == undefined)
        return;

      if (possibleMoves.indexOf(attackDir) != -1 && directionScore > bestAttackDirection) {
        bestAttackDirection = attackDir;
        bestAttackDirectionScore = directionScore;
      }
    })

    if (bestAttackDirection != null) {
      console.log("ATTACK: " + "CLOSE BEST DIR");
      return bestAttackDirection;
    }
  }

  //Case where range is greater than 2
  {
    let bestAttackDirection = null;
    let bestAttackDirectionScore = -1

    attackDesiredMoves.forEach(function(attackDir) {
      directionScore = directionsToScores[attackDir];

      if (directionScore == undefined)
        return;

      let frac = (DISTANCE_TO_SCAN_ENEMY_ATTACK / distanceToEnemy) / (DISTANCE_TO_SCAN_ENEMY_ATTACK);
      if (frac < MIN_ENEMY_ATTACK_FRAC_FROM_HIGHEST_SCORE)
        frac = MIN_ENEMY_ATTACK_FRAC_FROM_HIGHEST_SCORE;

      if (directionScore > highestScoreDirection.score * frac && directionScore > bestAttackDirectionScore) {
        if (possibleMoves.indexOf(attackDir) != -1) {
          bestAttackDirection = attackDir;
          bestAttackDirectionScore = directionScore;
        }
      }
    })
    //If we find a good enough attack direction, go that way
    if (bestAttackDirection != null) {
      console.log("ATTACK: " + "FAR BEST DIR");
      return bestAttackDirection;
    }
  }

  //If no direction found for attacking enemy, just go to highest direction
  console.log("ATTACK: " + "HIGHEST DIR");
  return highestScoreDirection.direction;
}

function GetDistance(position1, position2) {
    let xDistance = Math.abs(position1.x - position2.x);
    let yDistance = Math.abs(position1.y - position2.y);
    let totalDistance = xDistance + yDistance;

    return totalDistance;
}

function GetBestMoveTargetFood(gameData, boardMap, foodPosition, minFracFromHighestScore) {

  let possibleMoves = GetPossibleMoves(gameData, gameData.you.head, boardMap); //Array consisting of [left, right, up, down] 

  let headPosition = gameData.you.head;

  let foodDesiredMoves = [];
  {
    if (headPosition.x > foodPosition.x)
      foodDesiredMoves.push('left')
    else if (headPosition.x < foodPosition.x)
      foodDesiredMoves.push('right')

    if (headPosition.y > foodPosition.y)
      foodDesiredMoves.push('down')
    else if (headPosition.y < foodPosition.y)
      foodDesiredMoves.push('up')
  }
  
  let directionsToScores = GetDirectionsToScores(gameData, boardMap);
  let highestScoreDirection = directionsToScores["highestScoreDirection"];

  //If direction with highest score is towards food! Great! go that way!
  if (foodDesiredMoves.indexOf(highestScoreDirection.direction) != -1) {
    console.log("FOOD: BEST DIR!!");
    return highestScoreDirection.direction;
  }

  //If direction with highest score is not towards food...
  //check if food directions are still good enough to go to (close enough score to highest score direction)
  {
    let direction = null;
    let bestFoodDirectionScore = -1

    foodDesiredMoves.forEach(function(foodDirection) {
      directionScore = directionsToScores[foodDirection];

      if (directionScore == undefined)
        return;

      let frac = (gameData.you.health / 100);
      if (frac < minFracFromHighestScore)
        frac = minFracFromHighestScore;

      if (directionScore > highestScoreDirection.score * frac && directionScore > bestFoodDirectionScore) {
        direction = foodDirection;
        bestFoodDirectionScore = directionScore;
      }
    })
    //If we find a good enough food direction, go that way
    if (direction != null) {
      console.log("FOOD: FOOD DIR");
      return direction;
    }
  }

  //Return best direction if food directions are not good enough
  console.log("FOOD: HIGHEST DIR");
  return highestScoreDirection.direction;
}

//Will just return direction with highest score
function GetBestMoveDefault(gameData, boardMap) {

  let nearestFood = ScanNearbyFood(gameData, DISTANCE_TO_SCAN_FOR_FOOD_ON_DEFAULT);

  if (nearestFood.position != null) {
    return GetBestMoveTargetFood(gameData, boardMap, nearestFood.position)
  }
  else {
    return GetDirectionsToScores(gameData, boardMap)["highestScoreDirection"].direction;
  }
}

function GetDirectionsToScores(gameData, boardMap) {

  let headPosition = gameData.you.head;

  const possibleDirections = GetPossibleMoves(gameData, headPosition, boardMap);

  let directionToScore = {};
  let highestScoreDirection = {
    direction: null,
    score: -1
  }
  possibleDirections.forEach(function(direction) {
    let score = CalculateGridPositionScore(GetProposedPosition(headPosition, direction), CALCULATE_SCORE_ITERATION, []);

    directionToScore[direction] = score;

    if (score > highestScoreDirection.score) {
      if (score > highestScoreDirection.score) {
        highestScoreDirection = {
          direction: direction,
          score: score
        }
      }
    }

    console.log(direction + " " + score);
  })

  directionToScore["highestScoreDirection"] = highestScoreDirection;

  return directionToScore;

  function CalculateGridPositionScore(position, iterationLeft, visited) {
    let visitedClone = Array.from(visited);
    visitedClone.push(position);

    if (iterationLeft == 0) {
      return 0;
    }

    let nextPositions = [];

    let possibleMoves = GetPossibleMoves(gameData, position, boardMap);

    possibleMoves.forEach(function(direction) {
      let nextPosition = GetProposedPosition(position, direction);

      //Check if already visited
      {
        let index = visitedClone.indexOf(nextPosition);
        if (index != -1) {
          return;
        }
      }
      //Check if deadend: TODO MAKE IT BETTER!
      {
        let nextProposedPossibleMoves = GetPossibleMoves(gameData, nextPosition, boardMap);
        let nextPossibleMoves = [];
        nextProposedPossibleMoves.forEach(function(proposedNextDirection) {
          let index = visitedClone.indexOf(proposedNextDirection);
          if (index == -1) {
            nextPossibleMoves.push(proposedNextDirection);
          }
        })

        if (nextPossibleMoves.length == 0)
          return;
      }

      nextPositions.push(nextPosition);
    })
    let score = (nextPositions.length) * Math.pow(2,iterationLeft); //0 if no next position

    nextPositions.forEach(function(nextPosition) {
      score += CalculateGridPositionScore(nextPosition, iterationLeft - 1, visitedClone);
    })

    return score;
  }
}

function GetProposedPosition(currentPosition, move) {
  switch(move) {
    case ('left'):
      return {x: currentPosition.x-1, y: currentPosition.y }
    case ('right'):
      return {x: currentPosition.x+1, y: currentPosition.y }
    case ('up'):
      return {x: currentPosition.x, y: currentPosition.y+1 }
    case ('down'):
      return {x: currentPosition.x, y: currentPosition.y-1 }
  }
}

function GetMoveState(gameData) {
  let currentState = null;
  let headPosition = gameData.you.head;
  //Closest food position
  {
    let closestFood = {
      position: null,
      distance: Infinity
    };
    let foodPositions = gameData.board.food;
    foodPositions.forEach(function(foodPosition) {
      let distanceToFood = GetDistance(headPosition, foodPosition);

      if (distanceToFood < closestFood.distance) {
        closestFood = {
          position: foodPosition,
          distance: distanceToFood
        }
      }
    })

    let health = gameData.you.health;

    if (health > HEALTH_TO_START_STARVE_STATE) {

      let attackableEnemy = GetAttackableEnemy(gameData, DISTANCE_TO_SCAN_ENEMY_ATTACK).snake;

      if (attackableEnemy != null) {
        currentState = 
        {
          id: STATE_ATTACK,
          enemySnake: attackableEnemy
        }
      }
      else {
        currentState = 
        {
          id: STATE_TARGETFOOD,
          closestFoodPosition: closestFood.position
        }
      }
    }
    else {
      currentState = 
      {
        id: STATE_STARVING,
        closestFoodPosition: closestFood.position
      }
    }
  }

  return currentState;
}

function GetAttackableEnemy(gameData, distanceToScanEnemy) {
  let targetEnemy = {
    snake: null,
    distance: Infinity
  };
  
  let otherSnakes = gameData.board.snakes;
  let you = gameData.you;

  otherSnakes.forEach(function(snake) {

    if (snake.id.localeCompare(you.id) == 0) {
      return;
    }

    let distanceToEnemy = GetDistance(snake.head, you.head);

    if (distanceToEnemy <= distanceToScanEnemy && distanceToEnemy < targetEnemy.distance) {
      if (snake.length < you.length) {
        targetEnemy = {
          snake: snake,
          distance: distanceToEnemy
        }
      }
    }
  })

  return targetEnemy;
}

function ScanNearbyFood(gameData, maxDistanceToFood) {
  let foodPositions = gameData.board.food

  let closestFood = {
    position: null,
    distance: Infinity
  }
  foodPositions.forEach(function(pos) {
    let distanceToFood = GetDistance(pos, gameData.you.head);
    if (distanceToFood < closestFood.distance) {
      closestFood = {
        position: pos,
        distance: distanceToFood
      }
    }
  })
  return closestFood;
}

function GetBoardInfo(boardMap, position) {
  if (boardMap[position.x] == undefined)
    return null;
  else if (boardMap[position.x][position.y] == undefined)
    return null;
  else {
    return boardMap[position.x][position.y];
  }
}

function handleEnd(request, response) {
  console.log('END')
  response.status(200).send('ok')
}
