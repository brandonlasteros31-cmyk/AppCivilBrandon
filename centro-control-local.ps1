$ErrorActionPreference = 'Stop'
$script:Root = $PSScriptRoot
$script:DataDir = Join-Path $Root 'datos-centro-control'
$script:UploadDir = Join-Path $script:DataDir 'archivos'
$script:StatePath = Join-Path $script:DataDir 'registro.json'
$script:HtmlPath = Join-Path $Root 'centro-de-control-boceto-integrado.html'
$script:Sessions = @{}
New-Item -ItemType Directory -Force -Path $script:UploadDir | Out-Null
if (Test-Path $script:StatePath) {
    $script:State = Get-Content -Raw -Encoding UTF8 $script:StatePath | ConvertFrom-Json
} else {
    $script:State = [pscustomobject]@{
        allowedEmails = @('brandonlasteros31@gmail.com', 'gledymedina02@gmail.com')
        invitations = @()
        users = @()
        submissions = @()
    }
}
if (-not $script:State.PSObject.Properties['project']) { $script:State | Add-Member -NotePropertyName project -NotePropertyValue ([pscustomobject]@{}) }
foreach ($submission in @($script:State.submissions)) {
    if (-not $submission.PSObject.Properties['editAuthorized']) { $submission | Add-Member -NotePropertyName editAuthorized -NotePropertyValue $false }
    if (-not $submission.PSObject.Properties['editRequestStatus']) { $submission | Add-Member -NotePropertyName editRequestStatus -NotePropertyValue 'none' }
    if (-not $submission.PSObject.Properties['editRequestNote']) { $submission | Add-Member -NotePropertyName editRequestNote -NotePropertyValue '' }
}
function Save-State {
    $json = ConvertTo-Json -InputObject $script:State -Depth 30
    [System.IO.File]::WriteAllText($script:StatePath, $json, [System.Text.UTF8Encoding]::new($false))
}
function Send-Json($Context, $Value, [int]$Status = 200) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 30 -Compress))
    $Context.Response.StatusCode = $Status
    $Context.Response.ContentType = 'application/json; charset=utf-8'
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.Close()
}
function Read-Body($Context) {
    if ($Context.Request.ContentLength64 -gt 30000000) { throw 'El envío supera el máximo permitido.' }
    $reader = [System.IO.StreamReader]::new($Context.Request.InputStream, $Context.Request.ContentEncoding)
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Read-Json($Context) {
    $text = Read-Body $Context
    if ([string]::IsNullOrWhiteSpace($text)) { throw 'Faltan datos.' }
    return ($text | ConvertFrom-Json)
}
function New-PasswordRecord([string]$Password) {
    $salt = New-Object byte[] 16
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
    $derive = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($Password, $salt, 150000)
    try { return @{ salt = [Convert]::ToBase64String($salt); hash = [Convert]::ToBase64String($derive.GetBytes(32)) } }
    finally { $derive.Dispose() }
}
function Test-Password($User, [string]$Password) {
    $salt = [Convert]::FromBase64String($User.salt)
    $derive = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($Password, $salt, 150000)
    try {
        $actual = [Convert]::ToBase64String($derive.GetBytes(32))
        return $actual -ceq $User.hash
    } finally { $derive.Dispose() }
}
function Get-User($Context) {
    $header = $Context.Request.Headers['Authorization']
    if ($header -notmatch '^Bearer (.+)$') { return $null }
    $token = $Matches[1]
    if ($script:Sessions.ContainsKey($token)) {
        $email = $script:Sessions[$token]
        return @($script:State.users | Where-Object { $_.email -eq $email } | Select-Object -First 1)[0]
    }
    return $null
}
function Require-Admin($Context) {
    $user = Get-User $Context
    if (-not $user -or $user.role -ne 'admin') { Send-Json $Context @{ error = 'Necesitas entrar como administrador.' } 401; return $null }
    return $user
}
function Find-Submission([string]$Id) {
    return @($script:State.submissions | Where-Object { $_.id -eq $Id } | Select-Object -First 1)[0]
}
function Handle-Request($Context) {
    $path = $Context.Request.Url.AbsolutePath
    $method = $Context.Request.HttpMethod
    if ($method -eq 'GET' -and $path -in @('/', '/demo')) {
        $pagePath = if ($path -eq '/demo') { Join-Path $script:Root 'centro-de-control-demo.html' } else { $script:HtmlPath }
        if (-not (Test-Path $pagePath)) { Send-Json $Context @{ error = 'No se encuentra el archivo HTML.' } 500; return }
        $bytes = [System.IO.File]::ReadAllBytes($pagePath)
        $Context.Response.ContentType = 'text/html; charset=utf-8'
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Context.Response.Close()
        return
    }
    if ($method -eq 'GET' -and $path -eq '/centro-control-share.js') {
        $scriptPath = Join-Path $script:Root 'centro-control-share.js'
        if (-not (Test-Path $scriptPath)) { Send-Json $Context @{ error = 'No se encuentra el archivo de entregas.' } 500; return }
        $bytes = [System.IO.File]::ReadAllBytes($scriptPath)
        $Context.Response.ContentType = 'application/javascript; charset=utf-8'
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Context.Response.Close()
        return
    }
    if ($method -eq 'GET' -and $path -eq '/centro-control-ubigeo.json') {
        $catalogPath = Join-Path $script:Root 'centro-control-ubigeo.json'
        if (-not (Test-Path $catalogPath)) { Send-Json $Context @{ error = 'No se encuentra la lista de ubicaciones.' } 500; return }
        $bytes = [System.IO.File]::ReadAllBytes($catalogPath)
        $Context.Response.ContentType = 'application/json; charset=utf-8'
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Context.Response.Close()
        return
    }
    if ($method -eq 'GET' -and $path -eq '/centro-control-ubigeo.json') {
        $catalogPath = Join-Path $script:Root 'centro-control-ubigeo.json'
        if (-not (Test-Path $catalogPath)) { Send-Json $Context @{ error = 'No se encuentra la lista de ubicaciones.' } 500; return }
        $bytes = [System.IO.File]::ReadAllBytes($catalogPath)
        $Context.Response.ContentType = 'application/json; charset=utf-8'
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Context.Response.Close()
        return
    }
    if ($method -eq 'GET' -and $path -eq '/api/status') {
        Send-Json $Context @{ setup = (@($script:State.users | Where-Object role -eq 'admin').Count -eq 0); adminEmail = 'brandonlasteros31@gmail.com' }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/project') {
        if (-not (Require-Admin $Context)) { return }
        $data = Read-Json $Context
        $locationCodes = @([string]$data.departmentCode, [string]$data.provinceCode, [string]$data.districtCode)
        if (($locationCodes | Where-Object { $_ } | Measure-Object).Count -gt 0) {
            if ($locationCodes.Where({ -not $_ }).Count -gt 0) { Send-Json $Context @{ error = 'Selecciona departamento, provincia y distrito.' } 400; return }
            $catalog = Get-Content -Raw -Encoding UTF8 (Join-Path $script:Root 'centro-control-ubigeo.json') | ConvertFrom-Json
            $department = @($catalog.departments | Where-Object { [string]$_.id -eq [string]$data.departmentCode } | Select-Object -First 1)[0]
            $province = @($catalog.provinces | Where-Object { [string]$_.id -eq [string]$data.provinceCode -and [string]$_.department_id -eq [string]$data.departmentCode } | Select-Object -First 1)[0]
            $district = @($catalog.districts | Where-Object { [string]$_.id -eq [string]$data.districtCode -and [string]$_.province_id -eq [string]$data.provinceCode -and [string]$_.department_id -eq [string]$data.departmentCode } | Select-Object -First 1)[0]
            if (-not $department -or -not $province -or -not $district) { Send-Json $Context @{ error = 'La ubicación seleccionada no es válida.' } 400; return }
        } else {
            $department = $null; $province = $null; $district = $null
        }
        $script:State.project = [pscustomobject]@{
            name = ([string]$data.name).Trim()
            entity = ([string]$data.entity).Trim()
            code = ([string]$data.code).Trim()
            cutoff = [string]$data.cutoff
            description = ([string]$data.description).Trim()
            departmentCode = if ($department) { [string]$department.id } else { '' }
            department = if ($department) { [string]$department.name } else { '' }
            provinceCode = if ($province) { [string]$province.id } else { '' }
            province = if ($province) { [string]$province.name } else { '' }
            districtCode = if ($district) { [string]$district.id } else { '' }
            district = if ($district) { [string]$district.name } else { '' }
            location = if ($district) { [string]$district.name + ', ' + [string]$province.name + ', ' + [string]$department.name } else { '' }
        }
        Save-State
        Send-Json $Context @{ ok = $true; project = $script:State.project }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/setup') {
        $data = Read-Json $Context
        if (@($script:State.users | Where-Object role -eq 'admin').Count -gt 0) { Send-Json $Context @{ error = 'La cuenta de administración ya está creada.' } 409; return }
        $email = ([string]$data.email).Trim().ToLowerInvariant()
        if ($email -ne 'brandonlasteros31@gmail.com') { Send-Json $Context @{ error = 'Usa el correo de administrador indicado.' } 403; return }
        if ([string]$data.password -cne [string]$data.confirm -or ([string]$data.password).Length -lt 10) { Send-Json $Context @{ error = 'La contraseña debe tener al menos 10 caracteres y coincidir.' } 400; return }
        $record = New-PasswordRecord ([string]$data.password)
        $script:State.users = @($script:State.users) + @([pscustomobject]@{ email = $email; salt = $record.salt; hash = $record.hash; role = 'admin'; created = (Get-Date).ToString('o') })
        Save-State
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/activate') {
        $data = Read-Json $Context
        $email = ([string]$data.email).Trim().ToLowerInvariant()
        $displayName = ([string]$data.name).Trim()
        $invite = @($script:State.invitations | Where-Object { $_.email -eq $email -and $_.code -eq [string]$data.code -and -not $_.used } | Select-Object -First 1)[0]
        if (-not $invite -or $email -notin @($script:State.allowedEmails)) { Send-Json $Context @{ error = 'Correo o código de invitación incorrecto.' } 403; return }
        if (@($script:State.users | Where-Object email -eq $email).Count -gt 0) { Send-Json $Context @{ error = 'Ese correo ya tiene acceso.' } 409; return }
        if ($displayName.Length -lt 2 -or $displayName.Length -gt 80) { Send-Json $Context @{ error = 'Escribe tu nombre completo.' } 400; return }
        if (([string]$data.password).Length -lt 10 -or [string]$data.password -cne [string]$data.confirm) { Send-Json $Context @{ error = 'La contraseña debe tener al menos 10 caracteres y coincidir.' } 400; return }
        $record = New-PasswordRecord ([string]$data.password)
        $script:State.users = @($script:State.users) + @([pscustomobject]@{ email = $email; displayName = $displayName; salt = $record.salt; hash = $record.hash; role = 'staff'; created = (Get-Date).ToString('o') })
        $invite.used = $true
        Save-State
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/login') {
        $data = Read-Json $Context
        $email = ([string]$data.email).Trim().ToLowerInvariant()
        $user = @($script:State.users | Where-Object email -eq $email | Select-Object -First 1)[0]
        if (-not $user -or -not (Test-Password $user ([string]$data.password))) { Send-Json $Context @{ error = 'Correo o contraseña incorrectos.' } 403; return }
        $bytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
        $script:Sessions[$token] = $email
        Send-Json $Context @{ token = $token; email = $email; role = $user.role }
        return
    }
    $user = Get-User $Context
    if ($method -eq 'GET' -and $path -eq '/api/project') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesión.' } 401; return }
        Send-Json $Context $script:State.project
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/logout') {
        $header = $Context.Request.Headers['Authorization']
        if ($header -match '^Bearer (.+)$') { $script:Sessions.Remove($Matches[1]) }
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'GET' -and $path -eq '/api/me') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesión.' } 401; return }
        Send-Json $Context @{ email = $user.email; displayName = $user.displayName; role = $user.role }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/profile') {
        if (-not $user -or $user.role -ne 'staff') { Send-Json $Context @{ error = 'Inicia sesión como personal autorizado.' } 401; return }
        $data = Read-Json $Context
        $displayName = ([string]$data.name).Trim()
        if ($displayName.Length -lt 2 -or $displayName.Length -gt 80) { Send-Json $Context @{ error = 'Escribe tu nombre completo.' } 400; return }
        $user.displayName = $displayName
        Save-State
        Send-Json $Context @{ ok = $true; displayName = $displayName }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/invite') {
        if (-not (Require-Admin $Context)) { return }
        $data = Read-Json $Context
        $email = ([string]$data.email).Trim().ToLowerInvariant()
        if ($email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$' -or $email -eq 'brandonlasteros31@gmail.com') { Send-Json $Context @{ error = 'Escribe un correo válido del personal.' } 400; return }
        if (@($script:State.users | Where-Object email -eq $email).Count -gt 0) { Send-Json $Context @{ error = 'Ese correo ya tiene acceso.' } 409; return }
        $script:State.allowedEmails = @($script:State.allowedEmails | Where-Object { $_ -ne $email }) + @($email)
        $script:State.invitations = @($script:State.invitations | Where-Object { $_.email -ne $email })
        $code = [Guid]::NewGuid().ToString('N').Substring(0, 12).ToUpperInvariant()
        $script:State.invitations = @($script:State.invitations) + @([pscustomobject]@{ email = $email; code = $code; used = $false; created = (Get-Date).ToString('o') })
        Save-State
        Send-Json $Context @{ email = $email; code = $code }
        return
    }
    if ($method -eq 'GET' -and $path -eq '/api/people') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesión.' } 401; return }
        $emails = if ($user.role -eq 'admin') { $script:State.allowedEmails } else { @($script:State.users | Where-Object role -eq 'staff' | ForEach-Object email) }
        $people = @($emails | ForEach-Object {
            $email = $_
            $account = @($script:State.users | Where-Object email -eq $email | Select-Object -First 1)[0]
            [pscustomobject]@{ email = $email; displayName = if ($account -and $account.displayName) { $account.displayName } else { $email }; active = [bool]$account; role = if ($account) { $account.role } else { 'Invitación pendiente' } }
        })
        Send-Json $Context $people
        return
    }
    if ($method -eq 'GET' -and $path -eq '/api/submissions') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesión.' } 401; return }
        $items = @($script:State.submissions | Where-Object { $user.role -eq 'admin' -or $_.email -eq $user.email } | Sort-Object created -Descending)
        Send-Json $Context $items
        return
    }
    if ($method -eq 'POST' -and $path -eq '/api/submissions') {
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesión con un correo autorizado para enviar.' } 403; return }
        $data = Read-Json $Context
        $files = @($data.files)
        if ([string]::IsNullOrWhiteSpace([string]$data.title) -or $files.Count -lt 1 -or $files.Count -gt 5) { Send-Json $Context @{ error = 'Escribe un asunto y adjunta entre 1 y 5 archivos.' } 400; return }
        $kind = if ([string]$data.kind -eq 'valuation') { 'valuation' } else { 'report' }
        $valuationNumber = ''; $valuationPeriod = ''; $valuationDue = ''; $plannedProgress = $null; $actualProgress = $null
        $conformityCategory = ''; $conformityDate = ''; $conformityDue = ''
        if ($kind -eq 'valuation') {
            if ([string]::IsNullOrWhiteSpace([string]$data.valuationNumber) -or [string]::IsNullOrWhiteSpace([string]$data.valuationPeriod) -or [string]::IsNullOrWhiteSpace([string]$data.valuationDue)) { Send-Json $Context @{ error = 'Completa el número, el período y el plazo de la valorización.' } 400; return }
            try {
                $plannedProgress = [Convert]::ToDouble([string]$data.plannedProgress, [System.Globalization.CultureInfo]::InvariantCulture)
                $actualProgress = [Convert]::ToDouble([string]$data.actualProgress, [System.Globalization.CultureInfo]::InvariantCulture)
            } catch { Send-Json $Context @{ error = 'Escribe ambos avances como porcentajes válidos.' } 400; return }
            if ($plannedProgress -lt 0 -or $plannedProgress -gt 100 -or $actualProgress -lt 0 -or $actualProgress -gt 100) { Send-Json $Context @{ error = 'Los porcentajes deben estar entre 0 y 100.' } 400; return }
            $valuationNumber = ([string]$data.valuationNumber).Trim()
            $valuationPeriod = [string]$data.valuationPeriod
            $valuationDue = [string]$data.valuationDue
        } elseif ([string]$data.kind -eq 'conformity') {
            $kind = 'conformity'
            $validCategories = @('Equipos','Bienes','Servicios')
            if ([string]$data.category -notin $validCategories -or [string]::IsNullOrWhiteSpace([string]$data.conformityDate) -or [string]::IsNullOrWhiteSpace([string]$data.conformityDue)) { Send-Json $Context @{ error = 'Selecciona el tipo de conformidad y completa la fecha y el plazo.' } 400; return }
            $conformityCategory = [string]$data.category
            $conformityDate = [string]$data.conformityDate
            $conformityDue = [string]$data.conformityDue
        }
        $allowed = @('.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.jpg','.jpeg','.png','.webp','.txt','.csv')
        $prepared = @(); $total = 0
        foreach ($file in $files) {
            $name = [System.IO.Path]::GetFileName([string]$file.name)
            $extension = [System.IO.Path]::GetExtension($name).ToLowerInvariant()
            if ($extension -notin $allowed) { Send-Json $Context @{ error = "Tipo de archivo no permitido: $name" } 400; return }
            $bytes = [Convert]::FromBase64String([string]$file.data)
            if ($bytes.Length -gt 15000000) { Send-Json $Context @{ error = 'Cada archivo debe pesar menos de 15 MB.' } 400; return }
            $total += $bytes.Length
            $prepared += ,@{ name = $name; bytes = $bytes; size = $bytes.Length; id = [Guid]::NewGuid().ToString('N') }
        }
        if ($total -gt 22000000) { Send-Json $Context @{ error = 'El total de archivos no puede superar 22 MB por envío.' } 400; return }
        $savedFiles = @()
        foreach ($file in $prepared) {
            [System.IO.File]::WriteAllBytes((Join-Path $script:UploadDir ($file.id + '.bin')), $file.bytes)
            $savedFiles += [pscustomobject]@{ id = $file.id; name = $file.name; size = $file.size }
        }
        $responsibleEmail = ([string]$data.responsibleEmail).Trim().ToLowerInvariant()
        if (-not $responsibleEmail) { $responsibleEmail = $user.email }
        $responsibleUser = @($script:State.users | Where-Object { $_.email -eq $responsibleEmail } | Select-Object -First 1)[0]
        if (-not $responsibleUser) { Send-Json $Context @{ error = 'Selecciona un responsable con cuenta activa.' } 400; return }
        $item = [pscustomobject]@{ id = [Guid]::NewGuid().ToString('N'); kind = $kind; email = $user.email; submitterName = if ($user.displayName) { $user.displayName } else { $user.email }; responsibleEmail = $responsibleEmail; responsibleName = if ($responsibleUser.displayName) { $responsibleUser.displayName } else { $responsibleUser.email }; number = if ($kind -eq 'valuation') { $valuationNumber } else { ([string]$data.number).Trim() }; documentDate = if ($kind -eq 'valuation') { $valuationPeriod } elseif ($kind -eq 'conformity') { $conformityDate } else { [string]$data.documentDate }; valuationPeriod = $valuationPeriod; valuationDue = $valuationDue; plannedProgress = $plannedProgress; actualProgress = $actualProgress; conformityCategory = $conformityCategory; conformityDate = $conformityDate; conformityDue = $conformityDue; title = ([string]$data.title).Trim(); note = [string]$data.note; created = (Get-Date).ToString('o'); status = 'Pendiente'; review = ''; reviewed = ''; editAuthorized = $false; editRequestStatus = 'none'; editRequestNote = ''; files = $savedFiles }
        $script:State.submissions = @($script:State.submissions) + @($item)
        Save-State
        Send-Json $Context @{ ok = $true; id = $item.id }
        return
    }
    if ($method -eq 'POST' -and [System.Text.RegularExpressions.Regex]::IsMatch($path, '^/api/submissions/([0-9a-f]{32})/review$')) {
        $submissionId = [System.Text.RegularExpressions.Regex]::Match($path, '^/api/submissions/([0-9a-f]{32})/review$').Groups[1].Value
        if (-not (Require-Admin $Context)) { return }
        $item = Find-Submission $submissionId
        if (-not $item) { Send-Json $Context @{ error = 'No encuentro esa entrega.' } 404; return }
        $data = Read-Json $Context
        if ([string]$data.status -notin @('Aprobada','Observada') -or ([string]$data.status -eq 'Observada' -and [string]::IsNullOrWhiteSpace([string]$data.review))) { Send-Json $Context @{ error = 'Para observar, escribe el motivo.' } 400; return }
        $item.status = [string]$data.status
        $item.review = ([string]$data.review).Trim()
        $item.reviewed = (Get-Date).ToString('o')
        Save-State
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'POST' -and [System.Text.RegularExpressions.Regex]::IsMatch($path, '^/api/submissions/([0-9a-f]{32})/edit-request$')) {
        $submissionId = [System.Text.RegularExpressions.Regex]::Match($path, '^/api/submissions/([0-9a-f]{32})/edit-request$').Groups[1].Value
        if (-not $user -or $user.role -ne 'staff') { Send-Json $Context @{ error = 'Solo el trabajador que hizo el envío puede solicitar cambios.' } 403; return }
        $item = Find-Submission $submissionId
        if (-not $item -or $item.email -ne $user.email) { Send-Json $Context @{ error = 'No puedes modificar esta entrega.' } 404; return }
        if ($item.editAuthorized) { Send-Json $Context @{ error = 'Ya tienes autorización para corregir esta entrega.' } 409; return }
        if ($item.editRequestStatus -eq 'pending') { Send-Json $Context @{ error = 'Tu solicitud ya está pendiente de revisión.' } 409; return }
        $data = Read-Json $Context
        $reason = ([string]$data.reason).Trim()
        if ($reason.Length -lt 3) { Send-Json $Context @{ error = 'Explica brevemente qué necesitas corregir.' } 400; return }
        $item.editRequestStatus = 'pending'
        $item.editRequestNote = $reason
        Save-State
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'POST' -and [System.Text.RegularExpressions.Regex]::IsMatch($path, '^/api/submissions/([0-9a-f]{32})/edit-decision$')) {
        $submissionId = [System.Text.RegularExpressions.Regex]::Match($path, '^/api/submissions/([0-9a-f]{32})/edit-decision$').Groups[1].Value
        if (-not (Require-Admin $Context)) { return }
        $item = Find-Submission $submissionId
        if (-not $item) { Send-Json $Context @{ error = 'No encuentro esa entrega.' } 404; return }
        if ($item.editRequestStatus -ne 'pending') { Send-Json $Context @{ error = 'Esta entrega no tiene una solicitud pendiente.' } 409; return }
        $data = Read-Json $Context
        if ([string]$data.status -notin @('authorized','denied')) { Send-Json $Context @{ error = 'Elige autorizar o rechazar la solicitud.' } 400; return }
        $item.editRequestStatus = [string]$data.status
        $item.editAuthorized = ([string]$data.status -eq 'authorized')
        Save-State
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'POST' -and [System.Text.RegularExpressions.Regex]::IsMatch($path, '^/api/submissions/([0-9a-f]{32})/edit$')) {
        $submissionId = [System.Text.RegularExpressions.Regex]::Match($path, '^/api/submissions/([0-9a-f]{32})/edit$').Groups[1].Value
        if (-not $user -or $user.role -ne 'staff') { Send-Json $Context @{ error = 'Solo el trabajador puede corregir su envío.' } 403; return }
        $item = Find-Submission $submissionId
        if (-not $item -or $item.email -ne $user.email) { Send-Json $Context @{ error = 'No puedes modificar esta entrega.' } 404; return }
        if (-not $item.editAuthorized) { Send-Json $Context @{ error = 'El administrador todavía no autorizó la corrección.' } 403; return }
        $data = Read-Json $Context
        $title = ([string]$data.title).Trim()
        if ($title.Length -lt 1) { Send-Json $Context @{ error = 'Escribe el asunto del informe.' } 400; return }
        $files = @($data.files)
        if ($files.Count -gt 5) { Send-Json $Context @{ error = 'Puedes adjuntar hasta 5 archivos.' } 400; return }
        $allowed = @('.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.jpg','.jpeg','.png','.webp','.txt','.csv')
        $prepared = @(); $total = 0
        foreach ($file in $files) {
            $name = [System.IO.Path]::GetFileName([string]$file.name)
            if ([System.IO.Path]::GetExtension($name).ToLowerInvariant() -notin $allowed) { Send-Json $Context @{ error = "Tipo de archivo no permitido: $name" } 400; return }
            $bytes = [Convert]::FromBase64String([string]$file.data)
            if ($bytes.Length -gt 15000000) { Send-Json $Context @{ error = 'Cada archivo debe pesar menos de 15 MB.' } 400; return }
            $total += $bytes.Length
            $prepared += ,@{ name = $name; bytes = $bytes; size = $bytes.Length; id = [Guid]::NewGuid().ToString('N') }
        }
        if ($total -gt 22000000) { Send-Json $Context @{ error = 'El total de archivos no puede superar 22 MB por envío.' } 400; return }
        $newFiles = @()
        foreach ($file in $prepared) {
            [System.IO.File]::WriteAllBytes((Join-Path $script:UploadDir ($file.id + '.bin')), $file.bytes)
            $newFiles += [pscustomobject]@{ id = $file.id; name = $file.name; size = $file.size }
        }
        if ($newFiles.Count -gt 0) {
            foreach ($oldFile in @($item.files)) { Remove-Item -LiteralPath (Join-Path $script:UploadDir ($oldFile.id + '.bin')) -Force -ErrorAction SilentlyContinue }
            $item.files = $newFiles
        }
        $item.title = $title
        $item.note = [string]$data.note
        $item.status = 'Pendiente'
        $item.review = ''
        $item.reviewed = ''
        $item.editAuthorized = $false
        $item.editRequestStatus = 'none'
        $item.editRequestNote = ''
        Save-State
        Send-Json $Context @{ ok = $true }
        return
    }
    if ($method -eq 'GET' -and [System.Text.RegularExpressions.Regex]::IsMatch($path, '^/api/files/([0-9a-f]{32})$')) {
        $fileId = [System.Text.RegularExpressions.Regex]::Match($path, '^/api/files/([0-9a-f]{32})$').Groups[1].Value
        if (-not $user) { Send-Json $Context @{ error = 'Inicia sesión.' } 401; return }
        $owner = @($script:State.submissions | Where-Object { @($_.files | Where-Object id -eq $fileId).Count -gt 0 } | Select-Object -First 1)[0]
        if (-not $owner -or ($user.role -ne 'admin' -and $owner.email -ne $user.email)) { Send-Json $Context @{ error = 'No tienes permiso para descargar este archivo.' } 403; return }
        $meta = @($owner.files | Where-Object id -eq $fileId | Select-Object -First 1)[0]
        $diskPath = Join-Path $script:UploadDir ($fileId + '.bin')
        if (-not (Test-Path $diskPath)) { Send-Json $Context @{ error = 'El archivo no está disponible.' } 404; return }
        $bytes = [System.IO.File]::ReadAllBytes($diskPath)
        $safeName = [System.Text.RegularExpressions.Regex]::Replace($meta.name, '[^a-zA-Z0-9._-]', '_')
        $Context.Response.ContentType = 'application/octet-stream'
        $Context.Response.Headers.Add('Content-Disposition', 'attachment; filename="' + $safeName + '"')
        $Context.Response.ContentLength64 = $bytes.Length
        $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Context.Response.Close()
        return
    }
    Send-Json $Context @{ error = 'Acción no disponible.' } 404
}
function Read-TcpContext($Client) {
    $stream = $Client.GetStream()
    $stream.ReadTimeout = 15000
    $headerBuffer = [System.IO.MemoryStream]::new()
    $oneByte = New-Object byte[] 1
    $headerEnd = $false
    while (-not $headerEnd -and $headerBuffer.Length -lt 16384) {
        if ($stream.Read($oneByte, 0, 1) -eq 0) { throw 'Conexión cerrada antes de recibir la solicitud.' }
        $headerBuffer.Write($oneByte, 0, 1)
        $current = $headerBuffer.ToArray()
        $length = $current.Length
        $headerEnd = $length -ge 4 -and $current[$length - 4] -eq 13 -and $current[$length - 3] -eq 10 -and $current[$length - 2] -eq 13 -and $current[$length - 1] -eq 10
    }
    if (-not $headerEnd) { throw 'Los encabezados de la solicitud son demasiado largos.' }
    $headerText = [System.Text.Encoding]::ASCII.GetString($headerBuffer.ToArray())
    $lines = $headerText -split "`r`n"
    $requestParts = $lines[0] -split ' '
    if ($requestParts.Count -lt 2) { throw 'La solicitud del navegador no es válida.' }
    $headers = [System.Collections.Specialized.NameValueCollection]::new()
    foreach ($line in $lines | Select-Object -Skip 1) {
        $colon = $line.IndexOf(':')
        if ($colon -gt 0) { $headers.Add($line.Substring(0, $colon).Trim(), $line.Substring($colon + 1).Trim()) }
    }
    $contentLength = 0
    if ($headers['Content-Length']) { $contentLength = [int]$headers['Content-Length'] }
    if ($contentLength -gt 30000000) { throw 'El envío supera el máximo permitido.' }
    $body = New-Object byte[] $contentLength
    $offset = 0
    while ($offset -lt $contentLength) {
        $read = $stream.Read($body, $offset, $contentLength - $offset)
        if ($read -eq 0) { throw 'El envío del navegador quedó incompleto.' }
        $offset += $read
    }
    $hostName = $headers['Host']
    if ([string]::IsNullOrWhiteSpace($hostName)) { $hostName = 'localhost:8765' }
    $url = [Uri]::new('http://' + $hostName + $requestParts[1])
    $request = [pscustomobject]@{
        HttpMethod = $requestParts[0]
        Url = $url
        Headers = $headers
        ContentLength64 = [long]$contentLength
        ContentEncoding = [System.Text.Encoding]::UTF8
        InputStream = [System.IO.MemoryStream]::new($body)
    }
    $response = [pscustomobject]@{
        StatusCode = 200
        ContentType = 'text/plain; charset=utf-8'
        ContentLength64 = [long]0
        Headers = [System.Collections.Specialized.NameValueCollection]::new()
        OutputStream = [System.IO.MemoryStream]::new()
        Closed = $false
    }
    $response | Add-Member -MemberType ScriptMethod -Name Close -Value { $this.Closed = $true }
    return [pscustomobject]@{ Request = $request; Response = $response }
}
function Write-TcpResponse($Client, $Context) {
    $response = $Context.Response
    $body = $response.OutputStream.ToArray()
    $response.ContentLength64 = $body.Length
    $reasons = @{ 200 = 'OK'; 400 = 'Bad Request'; 401 = 'Unauthorized'; 403 = 'Forbidden'; 404 = 'Not Found'; 409 = 'Conflict'; 413 = 'Payload Too Large'; 500 = 'Internal Server Error' }
    $reason = $reasons[[int]$response.StatusCode]
    if (-not $reason) { $reason = 'OK' }
    $headerText = "HTTP/1.1 $($response.StatusCode) $reason`r`nContent-Type: $($response.ContentType)`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`n"
    foreach ($key in $response.Headers.AllKeys) { $headerText += "$key`: $($response.Headers[$key])`r`n" }
    $headerText += "`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
    $stream = $Client.GetStream()
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
}
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, 8765)
try {
    $listener.Start()
    $networkIP = Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4DefaultGateway } | ForEach-Object { $_.IPv4Address.IPAddress } | Select-Object -First 1
    Write-Host 'Centro de control listo en esta computadora: http://localhost:8765'
    if ($networkIP) { Write-Host "Para la otra laptop conectada a la misma red Wi-Fi: http://${networkIP}:8765/" }
    Write-Host 'Deja esta ventana abierta mientras lo usas. Para apagarlo, presiona Ctrl+C.'
    Start-Process 'http://localhost:8765/'
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $context = $null
        try {
            $context = Read-TcpContext $client
            Handle-Request $context
        }
        catch {
            Write-Host ('Error: ' + $_.Exception.Message)
            if ($context -and -not $context.Response.Closed) {
                try { Send-Json $context @{ error = 'No se pudo completar esa acción. Revisa los datos e inténtalo otra vez.' } 500 } catch { }
            }
        }
        if ($context) { try { Write-TcpResponse $client $context } catch { Write-Host ('Error de respuesta: ' + $_.Exception.Message) } }
        $client.Close()
    }
} finally { $listener.Stop() }
