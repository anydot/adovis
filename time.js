$(document).ready(async function() {

    if (!Array.prototype.last) {
        Array.prototype.last = function() {
            return this[this.length - 1]
        }
    }

    let storage = window.localStorage

    let viewMain = $('#view-main')
    let viewLoginAdo = $('#view-login-ado')
    let viewLoginTgl = $('#view-login-tgl')

    let credentialsAdo = storage.getItem('credentialsAdo')
    let credentialsTgl = storage.getItem('credentialsToggl')

    function loginAdo() {

        viewLoginAdo.hide()
        if (credentialsTgl) {
            viewMain.show()
            renderReport()
        } else {
            viewLoginTgl.show()
        }

        credentialsAdo = 'adovis:' + $('#input-pat-ado').val()
        $('#input-pat-ado').val('')
        storage.setItem('credentialsAdo', credentialsAdo)
    }

    function loginTgl() {

        viewLoginTgl.hide()
        viewMain.show()

        credentialsTgl = $('#input-pat-tgl').val() + ':api_token'
        $('#input-pat-tgl').val('')
        storage.setItem('credentialsTgl', credentialsTgl)

        renderReport()
    }

    function logout() {

        viewMain.hide()
        viewLoginTgl.hide()
        viewLoginAdo.show()

        credentialsAdo = null
        credentialsTgl = null
        storage.removeItem('credentialsAdo')
        storage.removeItem('credentialsTgl')
        $('#input-pat-ado').val('')
        $('#input-pat-tgl').val('')
    }

    $('#button-login-ado').click(loginAdo)
    $('#button-login-tgl').click(loginTgl)
    $('#button-logout').click(logout)
    $('#button-logout2').click(logout)

    $('#input-pat-ado').keypress(function (e) {
        if (e.which == 13) {
            loginAdo()
            return false
        }
    })

    $('#input-pat-tgl').keypress(function (e) {
        if (e.which == 13) {
            loginTgl()
            return false
        }
    })

    if (credentialsAdo & credentialsTgl) {
        renderReport()
    } else if (credentialsAdo) {
        viewLoginTgl.show()
    } else {
        viewLoginAdo.show()
    }

    function renderReport() {

    }
})