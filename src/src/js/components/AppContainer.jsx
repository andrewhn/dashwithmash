import React from 'react';
import {
  RaisedButton,
  FlatButton,
  TextField,
  Card,
  CardHeader,
  CardTitle,
  CardText,
  CardActions,
  CircularProgress,
  Dialog,
  SelectField,
  MenuItem,
} from 'material-ui';
import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider';
import SocketStore from '../stores/SocketStore';
import Actions from '../actions/Actions';

const buttonStyle = {height: "50px"};
const contentStyle = () => {
  return {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    height: window.innerHeight + "px",
  }
};

export default class AppContainer extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
      name: '',
      game: '',
      stage: 'loading',
      creator: false,
      playerList: [],
      error: {
        open: false,
        title: '',
        content: '',
      },
      category: null,
      clue: '',
      answerText: '',
      answerReceived: undefined,
    };

    // binding of this
    this._onNameChange = this._onNameChange.bind(this);
    this._onGameChange = this._onGameChange.bind(this);
    this._onAnswerChange = this._onAnswerChange.bind(this);
    this._onSubmitIdentity = this._onSubmitIdentity.bind(this);
    this._onSubmitAnswer = this._onSubmitAnswer.bind(this);
    this._onSubmitGame = this._onSubmitGame.bind(this);
    this._onMessage = this._onMessage.bind(this);
    this._onCreate = this._onCreate.bind(this);
    this._onJoin = this._onJoin.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._onAddVote = this._onAddVote.bind(this);
    this._onRemoveVote = this._onRemoveVote.bind(this);
    this._onCancelJoin = this._onCancelJoin.bind(this);
    this._onErrorDialogClose = this._onErrorDialogClose.bind(this);
    this._onLogOut = this._onLogOut.bind(this);
    this._onCategoryChange = this._onCategoryChange.bind(this);
    this._onClueChange = this._onClueChange.bind(this);

    // change listeners
    SocketStore.addChangeListener(this._onMessage);

    // rejoining?
    let playerId = localStorage.getItem('playerId');
    if (playerId) {
      Actions.sendWSData('re-join', playerId);
    } else {
      this.state.stage = 'identify';
    }
  }

  _onMessage() {

    if (SocketStore.requiresReconnect()) {
      let playerId = localStorage.getItem('playerId');
      return Actions.reconnectSocket(playerId);
    }

    const message = SocketStore.getMessage();
    let state, tmpAnswer;
    switch (message.action) {
      case 'error':
        switch(message.message) {
          case "game-not-found":
            // user typed in this code, so need to inform them code
            // is wrong
            this.setState({
              error: {
                open: true,
                title: 'Game not found',
                content: 'Sorry, we couldn\'t find that game. Did you type the code correctly?',
              }
            })
            break;
          case "player-not-found":
            localStorage.setItem('playerId', '');
            this.setState({stage: 'identify'});
            break;
          case "game-in-progress":
            this.setState({
              error: {
                open: true,
                title: 'Game in progress',
                content: 'Sorry, you can\'t join a game that\'s in progress. To play, you\'ll need to create a new game',
              }
            })
            break;
        }
        break;
      case 're-joined':
        let payload = message.message;
        this.setState({
          name: payload.name,
          game: payload.gameId,
          creator: payload.creator,
          playersInGame: payload.players.length,
          playerList: payload.players,
          category: payload.category || '',
          clue: payload.clue || '',
          responsesReceived: payload.responsesReceived,
        });
        if (payload.next) {
          Actions.mockWSData(payload.next);
        }
        break;
      case 'got-name':
        localStorage.setItem('playerId', message.message);
        this.setState({stage: 'initial'});
        if (this.state.game) {
          Actions.sendWSData('join', this.state.game);
        }
        break;
      case 'created':
        this.setState({
          stage: 'waiting',
          playersInGame: 1,
          game: message.message,
        })
        break;
      case 'joined':
      case 'waiting':
        this.setState({
          stage: 'waiting',
          playersInGame: message.message.length,
          playerList: message.message,
        })
        break;
      case 'dasher':
        tmpAnswer = localStorage.getItem("tmp-answer") || "";  // if re-connecting
        this.setState({
          stage: 'dasher',
          answerText: tmpAnswer,
          answerReceived: message.message.answerReceived,
          responsesReceived: message.message.responsesReceived,
        })
        break;
      case 'pls-answer':
        tmpAnswer = localStorage.getItem("tmp-answer") || "";  // if re-connecting
        this.setState({
          stage: 'answering',
          answerText: tmpAnswer,
          answerReceived: message.message.answerReceived,
        })
        break;
      case 'got-answer':
        this.setState({answerReceived: true});
        break;
      case 'player-sent-answer':
        this.setState({responsesReceived: message.message});
        break;
      case 'read-answers':
        localStorage.setItem("tmp-answer", "");
        this.setState({
          stage: "reading",
          playerAnswers: message.message.map(d => {
            d.votes = 0;
            return d;
          }),
        })
        break;
      case 'listen-to-reading':
        localStorage.setItem("tmp-answer", "");
        this.setState({
          stage: "listen-to-reading",
        })
        break;
      case 'category-change':
        this.setState({category: message.message || ''});
        break;
      case 'clue-change':
        this.setState({clue: message.message || ''});
        break;
    }
  }

  _onCreate() {
    Actions.sendWSData('create', '');
    this.setState({
      creator: true,
      playerList: [this.state.name],
    })
  }

  _onJoin() {
    localStorage.removeItem("tmp-answer");
    this.setState({
      stage: 'join',
      creator: false,
    });
  }

  _onCancelJoin() {
    this.setState({
      stage: 'initial',
    })
  }

  _onStart() {
    Actions.sendWSData('start', '');
  }

  _onSubmitIdentity() {
    Actions.sendWSData('identify', this.state.name);
  }

  _onSubmitGame() {
    Actions.sendWSData('join', this.state.game);
  }

  _onSubmitAnswer() {
    Actions.sendWSData('answer', this.state.answerText);
  }

  _onAnswerChange(evt, value) {
    localStorage.setItem("tmp-answer", value);
    this.setState({answerText: value});
  }

  _onNameChange(evt, value) {
    this.setState({name: value})
  }

  _onGameChange(evt, value) {
    this.setState({game: value})
  }

  _onLeave() {
    Actions.sendWSData("leave", "");
    this.setState({game: "", stage: "initial"});
  }

  _onAddVote(idx) {
    const playerAnswers = this.state.playerAnswers;
    playerAnswers[idx].votes += 1;
    this.setState(playerAnswers);
  }

  _onRemoveVote(idx) {
    const playerAnswers = this.state.playerAnswers;
    playerAnswers[idx].votes = Math.max(0, playerAnswers[idx].votes - 1);
    this.setState(playerAnswers);
  }

  _onErrorDialogClose() {
    this.setState({
      error: {
        open: false,
        title: '',
        content: '',
      }
    })
  }

  _onLogOut() {
    localStorage.removeItem('playerId');
    this.setState({
      stage: 'identify',
      name: '',
    });
  }

  _onCategoryChange(evt, idx, value) {
    this.setState({category: value});
    Actions.sendWSData("category-change", value);
  }

  _onClueChange(evt, value) {
    this.setState({clue: value});
    setTimeout(() => {
      if (value == this.state.clue) {
        // check if user has finished typing
        Actions.sendWSData("clue-change", value);
      }
    }, 300);
  }

  render() {
    let content;
    switch(this.state.stage) {
      case 'loading':
        content = <div style={contentStyle()}>
          <CircularProgress size={80} thickness={5} />
        </div>;
        break;
      case 'identify':
        content = <div style={contentStyle()}>
            <div style={{width: "100%"}}>
              <p style={{textAlign: "center", fontSize: "24px"}}>dashwithmash.com</p>
              <p style={{textAlign: "center", paddingLeft: "30px", paddingRight: "30px"}}>
                Enter your name below to get started
              </p>
              <div style={{paddingLeft: "10px", paddingRight: "10px"}}>
                <TextField fullWidth={true}
                           id="name-input"
                           floatingLabelText="Name"
                           value={this.state.name}
                           onChange={this._onNameChange} />
              </div>
              <RaisedButton label="Done" primary={true} fullWidth={true} onClick={this._onSubmitIdentity}/>
            </div>
          </div>;
          setTimeout(() => document.getElementById("name-input").focus(), 300);
          break;
      case 'initial':
        content = <div style={contentStyle()}>
          <div style={{width: "100%", marginTop: "auto", marginBottom: "auto"}}>
            <p style={{textAlign: 'center', fontSize: '24px'}}>Hello, {this.state.name}</p>
            <RaisedButton label="Create a game" primary={true} fullWidth={true} onClick={this._onCreate}/>
            <RaisedButton label="Join a game" secondary={true} fullWidth={true} onClick={this._onJoin}/>
          </div>
          <RaisedButton label="Log out" fullWidth={true} onClick={this._onLogOut}/>
        </div>;
        break;
      case 'waiting':
        let startButton;
        if (this.state.creator) {
          startButton = <RaisedButton label="Start game!" primary={true} fullWidth={true} onClick={this._onStart} />;
        }
        content = <div style={contentStyle()}>
          <div style={{alignSelf: 'flex-start', width: "100%"}}>
            <RaisedButton label="Leave!" secondary={true} fullWidth={true} onClick={this._onLeave} />
          </div>
          <div style={{width: "100%", marginTop: "auto", marginBottom: "auto"}}>
            <div style={{padding: "10px"}}>
              <p style={{textAlign: 'center'}}>Game code is</p>
              <p style={{textAlign: 'center', fontSize: "30px"}}>{this.state.game}</p>
              <p style={{textAlign: 'center'}}>Waiting for other players to join (currently {this.state.playersInGame})</p>
              {this.state.playerList.map((p, i) => {
                return <p style={{textAlign: 'center', margin: "0px", padding: "0px", lineHeight: "15px"}} key={i}>{p}</p>;
              })}
            </div>
            {startButton}
          </div>
        </div>
        break;
      case 'join':
        content = <div style={contentStyle()}>
          <div style={{paddingLeft: "40px", paddingRight: "40px", textAlign: "center"}}>
            Enter a game code someone else has created below (case insensitive)
          </div>
          <div style={{paddingLeft: "10px", paddingRight: "10px", width: "100%"}}>
            <TextField fullWidth={true}
                       id="game-code-input"
                       floatingLabelText="Game code"
                       value={this.state.game}
                       onChange={this._onGameChange} />
          </div>
          <RaisedButton label="Done" primary={true} fullWidth={true} onClick={this._onSubmitGame}/>
          <RaisedButton label="Cancel" secondary={true} fullWidth={true} onClick={this._onCancelJoin}/>
        </div>;
        setTimeout(() => document.getElementById("game-code-input").focus(), 300);
        break;
      case 'dasher':
        content = <div style={contentStyle()}>
          <RaisedButton label={"Leave " + this.state.game} secondary={true} fullWidth={true} onClick={this._onLeave}/>
          <div style={{marginTop: "auto", marginBottom: "auto", width: "100%"}}>
            <div style={{padding: "10px"}}>
              <p style={{textAlign: 'center', fontSize: "30px"}}>Dasher!</p>
              <p style={{textAlign: 'center'}}>Waiting for players to submit their answers</p>
              <p style={{textAlign: 'center'}}>{this.state.responsesReceived} of {this.state.playersInGame} so far ... </p>
              <p style={{textAlign: 'center'}}>In the meantime, fill out the details below</p>
              <SelectField floatingLabelText="Category"
                           value={this.state.category}
                           fullWidth={true}
                           onChange={this._onCategoryChange} >
                <MenuItem value="Word" primaryText="Word" />
                <MenuItem value="Person" primaryText="Person" />
                <MenuItem value="Acronym" primaryText="Acronym" />
                <MenuItem value="Film" primaryText="Film" />
                <MenuItem value="Date" primaryText="Date" />
              </SelectField>
              <TextField fullWidth={true}
                         id="dasher-clue-input"
                         floatingLabelText={this.state.category ? this.state.category + ' (clue)' : 'Clue'}
                         value={this.state.clue}
                         onChange={this._onClueChange} />
              <TextField fullWidth={true}
                         id="dasher-answer"
                         floatingLabelText="Correct answer"
                         multiLine={true}
                         value={this.state.answerText}
                         onChange={this._onAnswerChange} />
            </div>
            <RaisedButton label="Done"
                          primary={true}
                          fullWidth={true}
                          onClick={this._onSubmitAnswer}
                          disabled={this.state.answerText.length == 0} />
            <p style={{textAlign: "center"}}>{this.state.answerReceived ? 'Got the answer - you can edit it until everyone has finished' : ''}</p>
          </div>
        </div>;
        break;
      case 'answering':
        let category, clue;
        if (this.state.category) {
          category = <p style={{fontSize: "24px", textAlign: "center"}}>{this.state.category}</p>;
        }
        if (this.state.clue) {
          clue = <p style={{fontSize: "18px", textAlign: "center"}}>"{this.state.clue}"</p>;
        }
        content = <div style={contentStyle()}>
          <RaisedButton label={"Leave " + this.state.game} secondary={true} fullWidth={true} onClick={this._onLeave}/>
          <div style={{marginTop: "auto", marginBottom: "auto", width: "100%"}}>
            {category}
            {clue}
            <div style={{padding: "10px"}}>
              <TextField multiLine={true} fullWidth={true}
                         floatingLabelText="Answer"
                         value={this.state.answerText}
                         onChange={this._onAnswerChange}></TextField>
            </div>
            <RaisedButton label="Done"
                          disabled={this.state.answerText.length == 0}
                          primary={true}
                          fullWidth={true}
                          onClick={this._onSubmitAnswer} />
            <p style={{textAlign: "center"}}>{this.state.answerReceived ? 'Got your answer - you can change it until everyone has finished' : ''}</p>
          </div>
        </div>;
        break;
      case 'reading':
        content = <div>
          <RaisedButton label={"Leave " + this.state.game} secondary={true} fullWidth={true} onClick={this._onLeave}/>
          <div style={{width: "100%", height: "30px"}}></div>
          <div style={{padding: "10px"}}>
            {this.state.playerAnswers.map((answer, i) => {
              return <Card key={i}>
                <CardTitle title={answer.name} subtitle={answer.votes + " votes"} />
                <CardText>{answer.answer}</CardText>
                <CardActions>
                  <RaisedButton label="Add vote" primary={true} onClick={() => this._onAddVote(i)} />
                  <RaisedButton label="Remove vote" secondary={true} onClick={() => this._onRemoveVote(i)} />
                </CardActions>
              </Card>;
            })}
          </div>
          <div style={{width: "100%", height: "30px"}}></div>
          <RaisedButton label="Next round!" primary={true} fullWidth={true} onClick={this._onStart}/>
        </div>
        break;
      case 'listen-to-reading':
        content = <div>
          <RaisedButton label={"Leave " + this.state.game} secondary={true} fullWidth={true} onClick={this._onLeave}/>
          <div style={{padding: "10px"}}>
            <div style={{paddingTop: window.innerHeight / 2 - 80, width: "100%"}}></div>
              <p style={{textAlign: "center"}}>Listen to the answers and vote!</p>
            </div>
          </div>;
          break;
    }

    const dialogActions = [
      <FlatButton label="Close" primary={true} onClick={this._onErrorDialogClose} />,
    ];

    return <MuiThemeProvider>
      <div>
        {content}
        <Dialog title={this.state.error.title}
                actions={dialogActions}
                modal={false}
                open={this.state.error.open}
                onRequestClose={this._onErrorDialogClose} >
          {this.state.error.content}
        </Dialog>
      </div>
    </MuiThemeProvider>;
  }

};

