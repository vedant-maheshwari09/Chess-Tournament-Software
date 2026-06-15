/**
 * The live controller
 *
 * @author Dean Clow
 * @copyright 2017 Dean Clow
 */

LiveController = function() {
    /**
     * The tournament id
     *
     * @type int
     */
    this.tournamentId = 0;

    /**
     * The current round
     *
     * @type int
     */
    this.currentRound = 1;

    /**
     * The current section
     *
     * @type string
     */
    this.currentSection = "";

    /**
     * The tournament name
     *
     * @type string
     */
    this.tournamentName = "";

    /**
     * Whether to show current signups
     *
     * @type boolean
     */
    this.showCurrentSignups = true;

    /**
     * The loading message for pairings
     *
     * @return void
     */
    this.pairingsLoading = function() {
        $("#pairingsTable").html('<div style="font-size:12px;padding:5px;text-align:center;margin-top:20px;"><img src="/images/loading.gif" /> Loading...</div>');
    };

    /**
     * The loading message for byes
     *
     * @return void
     */
    this.byesLoading = function() {
        $("#byesTable").html('<div style="font-size:12px;padding:5px;text-align:center;margin-top:20px;"><img src="/images/loading.gif" /> Loading...</div>');
    };

    /**
     * The loading message for registration
     *
     * @return void
     */
    this.registrationsLoading = function() {
        $("#registrationData").html('<div style="font-size:12px;padding:5px;text-align:center;margin-top:20px;"><img src="/images/loading.gif" /> Loading...</div>');
    };

    /**
     * The standings loading message
     *
     * @return void
     */
    this.standingsLoading = function() {
        $("#standingsTable").html('<div style="font-size:12px;padding:5px;text-align:center;margin-top:20px;"><img src="/images/loading.gif" /> Loading...</div>');
    };

    /**
     * The teams loading message
     *
     * @return void
     */
    this.teamsLoading = function() {
        $("#teamsTable").html('<div style="font-size:12px;padding:5px;text-align:center;margin-top:20px;"><img src="/images/loading.gif" /> Loading...</div>');
    };

    /**
     * Set the attributes
     *
     * @return void
     */
    this.set = function() {
        var me                      = this;
        me.currentSection           = $("#section").val();
        me.currentRound             = $("#round").val();
    };

    /**
     * Load the pairings!
     *
     * @param int round
     * @param int sectionId
     */
    this.loadPairings = function(showLoading) {
        var me              = this;
        
        if (!me.showCurrentSignups) {
            if (showLoading) {
                $("#pairingsTable").html('<div style="text-align:center;margin-top:20px;font-weight:bold;">Signups are currently disabled</div>');
            }
            return;
        }
        
        me.currentRound     = $("#round").val();
        me.currentSection   = $("#section").val();

        document.cookie = "live_default_section_" + me.tournamentId + "=" + me.currentSection;

        if(showLoading) {
            me.pairingsLoading();
        }

        $.ajax({
            url: "/live-api/load-pairings/"+me.tournamentId+"?round="+me.currentRound+"&section="+me.currentSection,
            cache: false,
            success: function(callback) {
                if(!callback.pairings || !callback.pairings[me.currentSection] || callback.pairings[me.currentSection].length==0){
                    //$(".dropContainer").hide();
                    $(".status").html("STATUS: Registering players");
                    me.getRegistrationList();
                    return false;
                }
                $.ajax({
                    url: "/js/application/templates/live-pairings.html?timestamp="+Math.floor(Date.now() / 1000),
                    cache: false,
                    success: function(source) {
                        template  = Handlebars.compile(source);
                        var data = { pairings: callback.pairings[me.currentSection] };
                        $("#pairingsTable").html(template(data));
                    }
                });
            }
        });
    };

    /**
     * Load the standings!
     *
     * @param int round
     * @param int sectionId
     */
    this.loadStandings = function(showLoading) {
        var me                      = this;
        
        if (!me.showCurrentSignups) {
            if (showLoading) {
                $("#standingsTable").html('<div style="text-align:center;margin-top:20px;font-weight:bold;">Signups are currently disabled</div>');
            }
            return;
        }
        
        if(showLoading){
            me.standingsLoading();
        }
        $.ajax({
            url: "/live-api/load-standings/"+me.tournamentId+"?round="+me.currentRound+"&section="+me.currentSection,
            cache: false,
            success: function(callback) {

                if(typeof callback.standings=='undefined' || !callback.standings[me.currentSection] || callback.standings[me.currentSection].length==0) {
                    $("#standingsTable").html("<div style='text-align:center;margin-top:20px;font-weight:bold;'>There are currently no standings to show</div>");
                    return false;
                }

                $.ajax({
                    url: "/js/application/templates/live-standings.html?timestamp="+Math.floor(Date.now() / 1000),
                    cache: false,
                    success: function(source) {
                        var rounds = [];
                        for(var i=1;i<=me.currentRound;i++){
                            rounds.push(i);
                        }
                        template  = Handlebars.compile(source);
                        var hasPrize = false;
                        if(!jQuery.isEmptyObject(callback.prizes) || !jQuery.isEmptyObject(callback.adhocPrizes)){
                            hasPrize = true;
                        }

                        var data = { standings: callback.standings[me.currentSection],
                                     first: callback.standings[me.currentSection][0],
                                     currentRound: me.currentRound,
                                     rounds: rounds,
                                     prizes: callback.prizes,
                                     'hasPrize': hasPrize,
                                     tiebreaks: callback.appliedTieBreaks,
                                     adhoc: callback.adhocPrizes,
                                     withdrew: callback.withdrew };

                        $("#standingsTable").html(template(data));
                    }
                });
            }
        });
    };

    /**
     * Load the team standings!
     *
     * @param int round
     * @param int sectionId
     */
    this.loadTeams = function(showLoading) {
        var me = this;
        
        if (!me.showCurrentSignups) {
            if (showLoading) {
                $("#teamsTable").html('<div style="text-align:center;margin-top:20px;font-weight:bold;">Signups are currently disabled</div>');
            }
            return;
        }
        
        if (showLoading) {
            me.teamsLoading();
        }
        $.ajax({
            url: "/live-api/load-teams/" + me.tournamentId + "?round=" + me.currentRound + "&section=" + me.currentSection,
            cache: false,
            success: function (callback) {
                if (typeof callback.standings=='undefined' || callback.standings.length == 0) {
                    $("#teamsTable").html("<div style='text-align:center;margin-top:5px;font-weight:bold'>There are no teams to show</div>");
                    return false;
                }
                $.ajax({
                    url: "/js/application/templates/live-teams.html?timestamp=" + Math.floor(Date.now() / 1000),
                    cache: false,
                    success: function (source) {
                        var rounds = [];
                        for (var i = 1; i <= me.currentRound; i++) {
                            rounds.push(i);
                        }
                        template = Handlebars.compile(source);
                        var data = { standings: callback.standings,
                                     tieBreaks: callback.tieBreaks,
                                     rounds: rounds };
                        $("#teamsTable").html(template(data));
                    }
                });
            }
        });
    };

    /**
     * Load the standings!
     *
     * @param int round
     * @param int sectionId
     */
    this.loadCurrentStatus = function(forceRoundChange, section) {
        var me = this;
        
        $.ajax({
            url: "/live-api/load/"+me.tournamentId,
            cache: false,
            success: function(callback) {
                var options     = callback.pairingsRound[$("#section").val()];
                $(".status").html("STATUS: "+callback.status[$("#section").val()]);
                //re-add the options to the selector
                $('#round').empty();
                for(var i=1;i<=parseInt(options);i++){
                    $('#round').append($("<option></option>").attr("value", i).text(i));
                }
                //reload if needed - only if signups are enabled
                if(me.showCurrentSignups && (parseInt(me.currentRound)>=parseInt(options) || forceRoundChange)){
                    if(me.currentSection==section){
                        me.currentRound = options;
                        $('#round').val(me.currentRound);
                        me.loadPairings(true);
                        me.loadStandings(true);
                        me.loadTeams(true);
                        me.loadByes();
                    }
                }
                $('#round').val(me.currentRound);
            }
        });
    };

    /**
     * Update the users view if necessary (driven by socket server)
     *
     *
     * @param int round
     * @param int sectionId
     */
    this.updateIfNecessary = function(round, section, forceUpdate) {
        var me = this;
        
        // Always load byes regardless of showCurrentSignups
        me.loadByes();
        
        // Always load current status to show proper tournament status
        if(forceUpdate){
            /*if(section==0){
                location.reload(true);
                return false;
            }*/
            me.loadCurrentStatus(true, section);
            $("#smallSavingModal").fadeIn('slow');
            setTimeout(function() {
                $("#smallSavingModal").fadeOut('slow');
            }, 2000);
        }else{
            me.loadCurrentStatus(false, section);
            $("#smallSavingModal").fadeIn('slow');
            setTimeout(function() {
                $("#smallSavingModal").fadeOut('slow');
            }, 2000);
            // Only reload pairings/standings if signups are enabled
            if(me.showCurrentSignups && me.currentSection==section && me.currentRound==round){
                me.loadPairings(false);
                me.loadStandings(false);
            }
        }
    }

    /**
     * Get the player list and display it!
     *
     * @return void
     */
    this.getRegistrationList = function() {
        $('#round').val(1);
        var me = this;
        $.ajax({
            url: "/online-registration/load/"+me.tournamentId,
            cache: false,
            error: function(xhr, status, error) {
                $("#pairingsTable").html("<p style='text-align:center;font-weight:bold;margin-top:20px;'>Error loading registration data: " + error + "</p>");
            },
            success: function(callback) {
                if (!callback) {
                    $("#pairingsTable").html("<p style='text-align:center;font-weight:bold;margin-top:20px;'>Error loading registration data</p>");
                    return;
                }
                // Show registration list in live view when rounds haven't started
                {
                    var players = [];
                    if(typeof callback.registrations=='undefined'){
                        $('#pairings h3').html(LiveController.tournamentName + ' <br /><span style="font-size:14px;">(0 Players Total)</span>');
                    }else{
                        $('#pairings h3').html(LiveController.tournamentName + ' <br /><span style="font-size:14px;">('+callback.registrations.rows.length+' Players Total)</span>');
                        for(var i=0;i<callback.registrations.rows.length;i++){
                            if(callback.registrations.rows[i].section_id==me.currentSection){
                                if(callback.registrations.rows[i].uscf_id.length>8){
                                    callback.registrations.rows[i].uscf_id = 'None';
                                }else{
                                    callback.registrations.rows[i].uscf_id = '<a style="cursor:pointer;" href="https://ratings.uschess.org/player/'+callback.registrations.rows[i].uscf_id+'" target="_blank">'+callback.registrations.rows[i].uscf_id+"</a>";
                                }
                                players.push({ name: callback.registrations.rows[i].name,
                                    uscfId: callback.registrations.rows[i].uscf_id,
                                    rating: callback.registrations.rows[i].rating,
                                    team: callback.registrations.rows[i].team_abv,
                                    fullTeam: callback.registrations.rows[i].team,
                                    grade: callback.registrations.rows[i].grade});
                            }
                        }
                    }
                    $.ajax({
                        url: "/js/application/templates/registrations.html?timestamp="+Math.floor(Date.now() / 1000),
                        cache: false,
                        success: function(source) {
                            template  = Handlebars.compile(source);
                            $("#pairingsTable").html(template({ 'players' : players,
                                'count'   : players.length,
                                'hideTeamsSchoolGrade': callback.tournament ? callback.tournament.hideTeamsSchoolGrade : false,
                                'section' : me.currentSection.replace("_", " ") }));
                        }
                    });
                }
            }
        });
    };

    /**
     * Load the subscribe
     *
     * @return void
     */
    this.loadSubscribe = function() {
        $("#subscribeModal").modal('show');
        setTimeout(function() {
            $("#email").focus();
        }, 500);
    };

    /**
     * Load the phone subscription modal
     *
     * @return void
     */
    this.loadPhoneSubscribe = function() {
        var me = this;
        $.ajax({
            url: "/tournament/print-full-player-list/"+me.tournamentId,
            cache: false,
            success: function(callback) {
                $('#uscfId').find("option:gt(0)").remove();

                if (callback.players.length > 0) {
                    $.each(callback.players, function (i, item) {
                        $('#uscfId').append($('<option>', {
                            value: item.uscfId,
                            text : item.name
                        }));
                    });
                }

                $("#subscribePhoneModal").modal('show');
                setTimeout(function() {
                    $("#phone").focus();
                }, 500);
            }
        });
    };

    /**
     * Check for existing cookie subscription
     *
     * @return void
     */
    this.checkForSubscription = function() {
        var me              = this;
        var email           = me.getCookie('email');
        var phone           = me.getCookie('phone');
        var tournamentIds   = me.getCookie('tournamentId');
        if(tournamentIds.length){
            tournamentIds = tournamentIds.split(',');
            for(var i=0;i<tournamentIds.length;i++){
                if(tournamentIds[i]==me.tournamentId){
                    if(email.length){
                        $("#subscriptionEmail").html('<i title="Subscribed" style="color:green;" class="fa fa-check-circle-o"></i> <span style="color:green;">email subscribed</span>');
                    }
                    if(phone.length){
                        $("#subscriptionPhone").html('<i title="Subscribed" style="color:green;" class="fa fa-check-circle-o"></i> <span style="color:green;">phone subscribed</span>');
                    }
                }
            }
        }
        $("#subscription").show();
    };

    /**
     * Get a cookie param
     *
     * @param cname
     * @returns {*}
     */
    this.getCookie = function(cname) {
        var name = cname + "=";
        var decodedCookie = decodeURIComponent(document.cookie);
        var ca = decodedCookie.split(';');
        for(var i = 0; i <ca.length; i++) {
            var c = ca[i];
            while (c.charAt(0) == ' ') {
                c = c.substring(1);
            }
            if (c.indexOf(name) == 0) {
                return c.substring(name.length, c.length);
            }
        }
        return "";
    }

    /**
     * Submit email subscription
     *
     * @return void
     */
    this.submitEmail = function() {
        var me = this;
        me.submitSubscription('email');
    };

    /**
     * Submit phone subscription
     *
     * @return void
     */
    this.submitPhone = function() {
        var me = this;
        //make sure the required fields are all there
        if($.trim($("#phone").val())=='' || $.trim($("#uscfId").val())==''){
            alert("Please enter a phone number and select a player");
            return false;
        }
        me.submitSubscription('phone');
    };

    /**
     * Submit a subscription
     *
     * @return void
     */
    this.submitSubscription = function(type) {
        //make sure the required fields are all there
        if($.trim($("#email").val())=='' && type!='phone'){
            alert("Please enter your email address");
            return false;
        }
        var checked = [];
        $('.modal-body input:checkbox').each(function () {
            if(this.checked){
                checked.push($(this).val());
            }
        });
        var me = this;
        $.ajax({
            url: "/tournament/save-subscription/"+me.tournamentId+"?email="+$("#email").val()+"&phone="+$("#phone").val()+"&uscfId="+$("#uscfId").val()+"&sections="+checked.join(','),
            cache: false,
            success: function(callback) {
                //add a cookie entry
                document.cookie = "email="+$("#email").val()+";";
                document.cookie = "phone="+$("#phone").val()+";";
                var tournamentIds = me.getCookie('tournamentId');
                tournamentIds += ","+me.tournamentId;
                document.cookie = "tournamentId="+tournamentIds+";";
                if(type=='email') $("#subscriptionEmail").html('<i title="Subscribed" style="color:green;" class="fa fa-check-circle-o"></i> <span style="color:green;">email subscribed</span>');
                if(type=='phone') $("#subscriptionPhone").html('<i title="Subscribed" style="color:green;" class="fa fa-check-circle-o"></i> <span style="color:green;">phone subscribed</span>');
                $("#subscribeModal").modal('hide');
                $("#subscribePhoneModal").modal('hide');
                $("#thankYouModal").modal('show');
                setTimeout(function() {
                    $("#thankYouModal").modal('hide');
                }, 3000);
            }
        });
    };

    /**
     * Load the byes list
     *
     * @return void
     */
    this.loadByes = function() {
        var me = this;
        me.byesLoading();
        $.ajax({
            url: "/live-api/byes/"+me.tournamentId,
            cache: false,
            success: function(callback) {
                if(callback.byes.length>0){
                    $.ajax({
                        url: "/js/application/templates/byes.html?timestamp="+Math.floor(Date.now() / 1000),
                        cache: false,
                        success: function(source) {
                            template  = Handlebars.compile(source);
                            $("#byesTable").html(template({ 'byes' : callback.byes }));
                        }
                    });
                }else{
                    $("#byesTable").html("<p style='text-align:center;margin-top:5px;font-weight:bold;'>No byes to show</p>");
                }
            }
        });
    };

    /**
     * Load the registration list
     *
     * @return void
     */
    this.loadRegistrationData = function() {
        var me = this;
        //me.registrationsLoading();
        $.ajax({
            url: "/live-tv/registration-data/"+me.tournamentId,
            cache: false,
            success: function(callback) {
                $.ajax({
                    url: "/js/application/templates/tv-registration.html?timestamp="+Math.floor(Date.now() / 1000),
                    cache: false,
                    success: function(source) {
                        template  = Handlebars.compile(source);
                        $("#registrationData").html(template(callback));
                    }
                });
            }
        });
    };

    /**
     * Show the clock
     *
     * @return void
     */
    this.showClock = function() {
        var today = new Date();
        var h = today.getHours();
        var m = today.getMinutes();
        if(m<10){
            m = "0" + m;
        }
        var mid = 'am';
        if(h==0) { //At 00 hours we need to show 12 am
            h = 12;
        }else if(h==12){
            mid = 'pm';
        }else if(h>12) {
            h = h%12;
            mid = 'pm';
        }
        if(h<10){
            h = "0" + h;
        }
        var width = $("#other").width();
        $("#time").html(h+":"+m+" "+mid);
        var timeWidth = $("#time").width();
        $("#timeContainer").css('left', ((width/2) - (timeWidth/2)) + 20);
    };
};
var LiveController = new LiveController();

Handlebars.registerHelper("counter", function (index){
    return index + 1;
});

Handlebars.registerHelper('if_eq', function(a, b, opts) {
    if(a == b) // Or === depending on your needs
        return opts.fn(this);
    else
        return opts.inverse(this);
});

Handlebars.registerHelper('ifIn', function(elem, list, options) {
    if($.inArray(parseInt(elem), list) > -1) {
        return options.fn(this);
    }
    return options.inverse(this);
});

Handlebars.registerHelper('get_length', function (obj, key) {
    if(typeof obj[key]=='undefined') return 0;
    return obj[key].length;
});
